using System.Diagnostics;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;

namespace RaceControl.TelemetryClient;

public sealed record TelemetryBridgeOptions(
    string ServerUrl,
    string IngestionKey,
    TelemetrySourceMode SourceMode,
    string? ReplayPath,
    double ReplaySpeed);

public sealed record TelemetryBridgeStatus(
    bool Running,
    bool ServerConnected,
    bool SourceConnected,
    bool Streaming,
    string SourceLabel,
    DateTimeOffset? LastSentAt,
    DateTimeOffset? LastAcknowledgedAt,
    string? LastError);

public sealed class TelemetryBridge(DiagnosticCapture diagnostics) : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan AcknowledgementTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan SourceInitialGrace = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan SourceFrameTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan WatchdogInterval = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan MaximumSourceRetryDelay = TimeSpan.FromSeconds(10);
    private const int MaximumServerMessageBytes = 64 * 1024;
    private readonly object gate = new();
    private CancellationTokenSource? cancellation;
    private Task? runTask;
    private IReplayControl? replayControl;
    private TelemetryBridgeStatus status = new(false, false, false, false, "Not connected", null, null, null);

    public event Action<TelemetryBridgeStatus>? StatusChanged;
    public event Action<string>? Log;
    public event Action<ReplayProgress>? ReplayProgressChanged;
    public TelemetryBridgeStatus Status { get { lock (gate) return status; } }

    public Task StartAsync(TelemetryBridgeOptions options)
    {
        lock (gate)
        {
            if (runTask is { IsCompleted: false }) throw new InvalidOperationException("The telemetry bridge is already running.");
            cancellation?.Dispose();
            cancellation = new CancellationTokenSource();
            UpdateStatus(current => current with
            {
                Running = true,
                ServerConnected = false,
                SourceConnected = false,
                Streaming = false,
                SourceLabel = SourceLabel(options),
                LastSentAt = null,
                LastAcknowledgedAt = null,
                LastError = null
            });
            runTask = RunAsync(options, cancellation.Token);
        }
        WriteLog($"Starting {SourceLabel(options)}.");
        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        Task? task;
        lock (gate)
        {
            cancellation?.Cancel();
            task = runTask;
        }
        if (task is not null)
        {
            try { await task; }
            catch (OperationCanceledException) { }
        }
    }

    public void SetReplayPaused(bool paused)
    {
        IReplayControl? control;
        lock (gate) control = replayControl;
        if (paused) control?.Pause();
        else control?.Resume();
    }

    public void RestartReplay()
    {
        IReplayControl? control;
        lock (gate) control = replayControl;
        control?.Restart();
    }

    private async Task RunAsync(TelemetryBridgeOptions options, CancellationToken cancellationToken)
    {
        var snapshots = Channel.CreateBounded<SessionState>(new BoundedChannelOptions(1)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.Wait
        });

        var sourceTask = options.SourceMode == TelemetrySourceMode.Live
            ? PumpLiveSourceWithRecoveryAsync(snapshots.Writer, cancellationToken)
            : PumpSingleSourceAsync(options, snapshots.Writer, cancellationToken);
        var socketTask = SendToServerAsync(options, snapshots.Reader, cancellationToken);
        try
        {
            await Task.WhenAll(sourceTask, socketTask);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            WriteLog($"Telemetry stopped: {error.Message}");
            UpdateStatus(current => current with { LastError = error.Message });
        }
        finally
        {
            UpdateStatus(current => current with
            {
                Running = false,
                ServerConnected = false,
                SourceConnected = false,
                Streaming = false
            });
            WriteLog("Telemetry bridge stopped.");
        }
    }

    private async Task PumpSingleSourceAsync(
        TelemetryBridgeOptions options,
        ChannelWriter<SessionState> writer,
        CancellationToken cancellationToken)
    {
        await using ITelemetrySource source = options.SourceMode switch
        {
            TelemetrySourceMode.Simulation => new SimulatedTelemetrySource(diagnostics),
            TelemetrySourceMode.DiagnosticReplay => new DiagnosticReplayTelemetrySource(
                options.ReplayPath ?? throw new InvalidOperationException("Choose a diagnostic replay ZIP."),
                options.ReplaySpeed,
                diagnostics),
            _ => throw new InvalidOperationException("Live sources use the recovery supervisor.")
        };
        AttachSource(source);
        try
        {
            await PumpSourceAttemptAsync(source, writer, cancellationToken);
            writer.TryComplete();
        }
        catch (Exception error)
        {
            writer.TryComplete(error);
            throw;
        }
        finally
        {
            DetachSource(source);
        }
    }

    private async Task PumpLiveSourceWithRecoveryAsync(
        ChannelWriter<SessionState> writer,
        CancellationToken cancellationToken)
    {
        var retryDelay = TimeSpan.FromSeconds(1);
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await using var source = new IracingSdkTelemetrySource(diagnostics);
                var activity = new SourceActivityWatchdog();
                void OnConnectionChanged(bool connected, string label)
                {
                    activity.SetConnected(connected, Stopwatch.GetTimestamp());
                    OnSourceConnectionChanged(connected, label);
                }
                void OnFrameObserved() => activity.ObserveFrame(Stopwatch.GetTimestamp());

                source.ConnectionChanged += OnConnectionChanged;
                source.FrameObserved += OnFrameObserved;
                source.Log += WriteLog;
                using var attemptCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var pumpTask = PumpSourceAttemptAsync(source, writer, attemptCancellation.Token);
                var watchdogTask = MonitorLiveSourceAsync(activity, attemptCancellation.Token);
                Exception? failure = null;
                try
                {
                    var completedTask = await Task.WhenAny(pumpTask, watchdogTask);
                    await completedTask;
                    if (completedTask == pumpTask && !cancellationToken.IsCancellationRequested)
                        failure = new InvalidOperationException("The iRacing SDK monitor ended unexpectedly.");
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception error)
                {
                    failure = error;
                }
                finally
                {
                    await attemptCancellation.CancelAsync();
                    try { await pumpTask; }
                    catch (OperationCanceledException) when (attemptCancellation.IsCancellationRequested) { }
                    catch (Exception error) { failure ??= error; }
                    try { await watchdogTask; }
                    catch (OperationCanceledException) when (attemptCancellation.IsCancellationRequested) { }
                    catch (Exception error) { failure ??= error; }
                    source.ConnectionChanged -= OnConnectionChanged;
                    source.FrameObserved -= OnFrameObserved;
                    source.Log -= WriteLog;
                }

                if (cancellationToken.IsCancellationRequested) return;
                var message = failure?.Message ?? "The iRacing SDK source stopped.";
                diagnostics.TryRecord("events.ndjson", new { type = "source.watchdog.restart", error = message });
                UpdateStatus(current => current with
                {
                    SourceConnected = false,
                    Streaming = false,
                    SourceLabel = "Restarting iRacing SDK source"
                });
                WriteLog($"{message} Recreating the SDK source in {retryDelay.TotalSeconds:0} second{(retryDelay == TimeSpan.FromSeconds(1) ? "" : "s")}.");
                await Task.Delay(retryDelay, cancellationToken);
                retryDelay = activity.HasObservedFrame
                    ? TimeSpan.FromSeconds(1)
                    : TimeSpan.FromSeconds(Math.Min(retryDelay.TotalSeconds * 2, MaximumSourceRetryDelay.TotalSeconds));
            }
        }
        finally
        {
            writer.TryComplete();
        }
    }

    private static async Task PumpSourceAttemptAsync(
        ITelemetrySource source,
        ChannelWriter<SessionState> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var snapshot in source.ReadAsync(cancellationToken))
            await writer.WriteAsync(snapshot, cancellationToken);
    }

    private static async Task MonitorLiveSourceAsync(SourceActivityWatchdog activity, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(WatchdogInterval, cancellationToken);
            if (activity.IsStalled(Stopwatch.GetTimestamp(), SourceInitialGrace, SourceFrameTimeout))
                throw new TimeoutException("The iRacing SDK remained connected but stopped producing telemetry frames.");
        }
    }

    private async Task SendToServerAsync(
        TelemetryBridgeOptions options,
        ChannelReader<SessionState> snapshots,
        CancellationToken cancellationToken)
    {
        var endpoint = BuildTelemetryUri(options.ServerUrl);
        SessionState? retainedSnapshot = null;
        while (!cancellationToken.IsCancellationRequested)
        {
            if (retainedSnapshot is null)
            {
                if (!await snapshots.WaitToReadAsync(cancellationToken)) return;
                while (snapshots.TryRead(out var available)) retainedSnapshot = available;
            }

            using var socket = new ClientWebSocket();
            var acknowledgements = new TelemetryAcknowledgementTracker();
            SessionState? latestSnapshot = null;
            long latestSequence = 0;
            try
            {
                socket.Options.SetRequestHeader("Authorization", $"Bearer {options.IngestionKey}");
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                socket.Options.KeepAliveTimeout = TimeSpan.FromSeconds(10);
                WriteLog($"Connecting to {endpoint.Host}…");
                await WithTimeoutAsync(
                    token => socket.ConnectAsync(endpoint, token),
                    ConnectTimeout,
                    "Server connection timed out.",
                    cancellationToken);
                UpdateStatus(current => current with
                {
                    ServerConnected = true,
                    Streaming = false,
                    LastError = null
                });
                diagnostics.TryRecord("events.ndjson", new { type = "server.connected", endpoint = endpoint.Host });
                WriteLog("Server connected.");

                var hello = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    type = "hello",
                    role = "telemetry",
                    clientId = Environment.MachineName
                }, JsonOptions);
                await SendAsync(socket, hello, cancellationToken);

                using var connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var receiveTask = MonitorServerAsync(socket, acknowledgements, OnAcknowledged, connectionCancellation.Token);
                var watchdogTask = MonitorTransportAsync(acknowledgements, connectionCancellation.Token);

                async Task SendSnapshotAsync(SessionState snapshot)
                {
                    latestSnapshot = snapshot;
                    latestSequence++;
                    acknowledgements.RegisterSent(latestSequence, Stopwatch.GetTimestamp());
                    diagnostics.TryRecordSampled("normalized", "normalized.ndjson", snapshot);
                    var payload = JsonSerializer.SerializeToUtf8Bytes(new
                    {
                        type = "telemetry.update",
                        sequence = latestSequence,
                        payload = snapshot
                    }, JsonOptions);
                    var sendTask = SendAsync(socket, payload, connectionCancellation.Token);
                    var completedTask = await Task.WhenAny(sendTask, receiveTask, watchdogTask);
                    if (completedTask == receiveTask) await receiveTask;
                    if (completedTask == watchdogTask) await watchdogTask;
                    await sendTask;
                    UpdateStatus(current => current with
                    {
                        LastSentAt = DateTimeOffset.UtcNow,
                        LastError = null
                    });
                }

                void OnAcknowledged(long sequence)
                {
                    if (!acknowledgements.Acknowledge(sequence, Stopwatch.GetTimestamp())) return;
                    diagnostics.TryRecordSampled("transport-ack", "events.ndjson", new { type = "telemetry.acknowledged", sequence });
                    UpdateStatus(current => current with
                    {
                        Streaming = current.ServerConnected && current.SourceConnected,
                        LastAcknowledgedAt = DateTimeOffset.UtcNow,
                        LastError = null
                    });
                }

                try
                {
                    await SendSnapshotAsync(retainedSnapshot!);
                    retainedSnapshot = null;
                    while (true)
                    {
                        var availableTask = snapshots.WaitToReadAsync(connectionCancellation.Token).AsTask();
                        var completedTask = await Task.WhenAny(availableTask, receiveTask, watchdogTask);
                        if (completedTask == receiveTask) await receiveTask;
                        if (completedTask == watchdogTask) await watchdogTask;
                        if (!await availableTask) return;

                        while (snapshots.TryRead(out var snapshot))
                            await SendSnapshotAsync(snapshot);
                    }
                }
                finally
                {
                    if (latestSnapshot is not null && acknowledgements.LastAcknowledgedSequence < latestSequence)
                        retainedSnapshot = latestSnapshot;
                    await connectionCancellation.CancelAsync();
                    try { await receiveTask; }
                    catch (OperationCanceledException) when (connectionCancellation.IsCancellationRequested) { }
                    catch when (cancellationToken.IsCancellationRequested) { }
                    try { await watchdogTask; }
                    catch (OperationCanceledException) when (connectionCancellation.IsCancellationRequested) { }
                    catch when (cancellationToken.IsCancellationRequested) { }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                diagnostics.TryRecord("events.ndjson", new { type = "server.disconnected", error = error.Message });
                UpdateStatus(current => current with
                {
                    ServerConnected = false,
                    Streaming = false,
                    LastError = error.Message
                });
                WriteLog($"Server connection lost: {error.Message}. Retrying in 2 seconds.");
                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
            }
        }
    }

    private async Task MonitorTransportAsync(
        TelemetryAcknowledgementTracker acknowledgements,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(WatchdogInterval, cancellationToken);
            var now = Stopwatch.GetTimestamp();
            if (acknowledgements.HasTimedOut(now, AcknowledgementTimeout))
                throw new TimeoutException("The server did not acknowledge telemetry within 3 seconds.");
            if (acknowledgements.IsAcknowledgementStale(now, AcknowledgementTimeout))
                UpdateStatus(current => current.Streaming ? current with { Streaming = false } : current);
        }
    }

    private static Task SendAsync(ClientWebSocket socket, ReadOnlyMemory<byte> payload, CancellationToken cancellationToken) =>
        WithTimeoutAsync(
            token => socket.SendAsync(payload, WebSocketMessageType.Text, true, token).AsTask(),
            SendTimeout,
            "Sending telemetry to the server timed out.",
            cancellationToken);

    private static async Task MonitorServerAsync(
        ClientWebSocket socket,
        TelemetryAcknowledgementTracker acknowledgements,
        Action<long> acknowledged,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[8_192];
        using var message = new MemoryStream();
        while (!cancellationToken.IsCancellationRequested)
        {
            message.SetLength(0);
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    var description = string.IsNullOrWhiteSpace(result.CloseStatusDescription)
                        ? "no reason provided"
                        : result.CloseStatusDescription;
                    throw new WebSocketException($"Server closed the connection ({result.CloseStatus}: {description}).");
                }
                if (result.MessageType != WebSocketMessageType.Text)
                    throw new InvalidDataException("The server sent an unsupported WebSocket message type.");
                if (message.Length + result.Count > MaximumServerMessageBytes)
                    throw new InvalidDataException("The server sent a message larger than 64 KB.");
                message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            using var document = JsonDocument.Parse(message.GetBuffer().AsMemory(0, checked((int)message.Length)));
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeElement) || typeElement.ValueKind != JsonValueKind.String)
                throw new InvalidDataException("The server sent a message without a type.");
            switch (typeElement.GetString())
            {
                case "telemetry.ack":
                    if (!root.TryGetProperty("sequence", out var sequenceElement) || !sequenceElement.TryGetInt64(out var sequence))
                        throw new InvalidDataException("The server sent an invalid telemetry acknowledgement.");
                    if (!acknowledgements.CanAcknowledge(sequence))
                        throw new InvalidDataException($"The server acknowledged unsent telemetry sequence {sequence}.");
                    acknowledged(sequence);
                    break;
                case "error":
                    var serverMessage = root.TryGetProperty("message", out var errorElement) && errorElement.ValueKind == JsonValueKind.String
                        ? errorElement.GetString()
                        : "The server rejected a telemetry message.";
                    throw new InvalidDataException(serverMessage);
            }
        }
    }

    private static async Task WithTimeoutAsync(
        Func<CancellationToken, Task> operation,
        TimeSpan timeout,
        string timeoutMessage,
        CancellationToken cancellationToken)
    {
        using var timeoutCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCancellation.CancelAfter(timeout);
        try
        {
            await operation(timeoutCancellation.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && timeoutCancellation.IsCancellationRequested)
        {
            throw new TimeoutException(timeoutMessage);
        }
    }

    public static Uri BuildTelemetryUri(string serverUrl)
    {
        if (!Uri.TryCreate(serverUrl.Trim(), UriKind.Absolute, out var parsed))
            throw new ArgumentException("Enter a complete server URL, such as https://broadcasts.example.com.");
        var builder = new UriBuilder(parsed);
        builder.Scheme = builder.Scheme.ToLowerInvariant() switch
        {
            "https" => "wss",
            "http" => "ws",
            "wss" => "wss",
            "ws" => "ws",
            _ => throw new ArgumentException("The server URL must use HTTPS, HTTP, WSS, or WS.")
        };
        if (builder.Path is "" or "/") builder.Path = "/socket";
        var query = builder.Query.TrimStart('?');
        builder.Query = string.IsNullOrEmpty(query) ? "role=telemetry" : $"{query}&role=telemetry";
        return builder.Uri;
    }

    private void AttachSource(ITelemetrySource source)
    {
        source.ConnectionChanged += OnSourceConnectionChanged;
        source.Log += WriteLog;
        if (source is IReplayControl control)
        {
            control.ProgressChanged += OnReplayProgressChanged;
            lock (gate) replayControl = control;
        }
    }

    private void DetachSource(ITelemetrySource source)
    {
        source.ConnectionChanged -= OnSourceConnectionChanged;
        source.Log -= WriteLog;
        if (source is IReplayControl control)
        {
            control.ProgressChanged -= OnReplayProgressChanged;
            lock (gate)
            {
                if (ReferenceEquals(replayControl, control)) replayControl = null;
            }
        }
    }

    private void OnSourceConnectionChanged(bool connected, string label)
    {
        diagnostics.TryRecord("events.ndjson", new { type = "source.connection", connected, label });
        UpdateStatus(current => current with
        {
            SourceConnected = connected,
            Streaming = connected && current.ServerConnected && current.Streaming,
            SourceLabel = label
        });
    }

    private void WriteLog(string message)
    {
        diagnostics.TryRecord("events.ndjson", new { type = "client.log", message });
        Log?.Invoke(message);
    }

    private void OnReplayProgressChanged(ReplayProgress progress)
    {
        if (progress.IsComplete)
            UpdateStatus(current => current with { Streaming = false, SourceLabel = "Diagnostic replay complete" });
        ReplayProgressChanged?.Invoke(progress);
    }

    private void UpdateStatus(Func<TelemetryBridgeStatus, TelemetryBridgeStatus> update)
    {
        TelemetryBridgeStatus next;
        lock (gate)
        {
            next = update(status);
            if (next == status) return;
            status = next;
        }
        StatusChanged?.Invoke(next);
    }

    private static string SourceLabel(TelemetryBridgeOptions options) => options.SourceMode switch
    {
        TelemetrySourceMode.Simulation => "Simulated telemetry",
        TelemetrySourceMode.DiagnosticReplay => $"Diagnostic replay — {Path.GetFileName(options.ReplayPath)}",
        _ => "Live iRacing SDK"
    };

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        lock (gate)
        {
            cancellation?.Dispose();
            cancellation = null;
        }
    }
}
