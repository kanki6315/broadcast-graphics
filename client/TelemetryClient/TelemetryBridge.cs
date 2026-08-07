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
    DateTimeOffset? LastTelemetryAt,
    string? LastError);

public sealed class TelemetryBridge(DiagnosticCapture diagnostics) : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(10);
    private readonly object gate = new();
    private CancellationTokenSource? cancellation;
    private Task? runTask;
    private IReplayControl? replayControl;
    private TelemetryBridgeStatus status = new(false, false, false, false, "Not connected", null, null);

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
                LastTelemetryAt = null,
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

        await using ITelemetrySource source = options.SourceMode switch
        {
            TelemetrySourceMode.Simulation => new SimulatedTelemetrySource(diagnostics),
            TelemetrySourceMode.DiagnosticReplay => new DiagnosticReplayTelemetrySource(
                options.ReplayPath ?? throw new InvalidOperationException("Choose a diagnostic replay ZIP."),
                options.ReplaySpeed,
                diagnostics),
            _ => new IracingSdkTelemetrySource(diagnostics)
        };
        source.ConnectionChanged += OnSourceConnectionChanged;
        source.Log += WriteLog;
        if (source is IReplayControl control)
        {
            control.ProgressChanged += OnReplayProgressChanged;
            lock (gate) replayControl = control;
        }

        var sourceTask = PumpSourceAsync(source, snapshots.Writer, cancellationToken);
        var socketTask = SendToServerAsync(options, snapshots.Reader, source as ICameraController, cancellationToken);
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
            source.ConnectionChanged -= OnSourceConnectionChanged;
            source.Log -= WriteLog;
            if (source is IReplayControl finishedReplayControl)
            {
                finishedReplayControl.ProgressChanged -= OnReplayProgressChanged;
                lock (gate)
                {
                    if (ReferenceEquals(replayControl, finishedReplayControl)) replayControl = null;
                }
            }
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

    private static async Task PumpSourceAsync(ITelemetrySource source, ChannelWriter<SessionState> writer, CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var snapshot in source.ReadAsync(cancellationToken))
                await writer.WriteAsync(snapshot, cancellationToken);
            writer.TryComplete();
        }
        catch (Exception error)
        {
            writer.TryComplete(error);
            throw;
        }
    }

    private async Task SendToServerAsync(
        TelemetryBridgeOptions options,
        ChannelReader<SessionState> snapshots,
        ICameraController? cameraController,
        CancellationToken cancellationToken)
    {
        var endpoint = BuildTelemetryUri(options.ServerUrl);
        while (!cancellationToken.IsCancellationRequested && await snapshots.WaitToReadAsync(cancellationToken))
        {
            using var socket = new ClientWebSocket();
            using var sendGate = new SemaphoreSlim(1, 1);
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
                UpdateStatus(current => current with { ServerConnected = true, LastError = null });
                diagnostics.TryRecord("events.ndjson", new { type = "server.connected", endpoint = endpoint.Host });
                WriteLog("Server connected.");

                var hello = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    type = "hello",
                    role = "telemetry",
                    clientId = Environment.MachineName,
                    capabilities = new { cameraControl = cameraController is not null }
                }, JsonOptions);
                await SendAsync(socket, hello, sendGate, cancellationToken);

                using var connectionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var receiveTask = MonitorServerAsync(socket, cameraController, sendGate, connectionCancellation.Token);

                try
                {
                    while (true)
                    {
                        var availableTask = snapshots.WaitToReadAsync(connectionCancellation.Token).AsTask();
                        var completedTask = await Task.WhenAny(availableTask, receiveTask);
                        if (completedTask == receiveTask)
                        {
                            await receiveTask;
                            throw new WebSocketException("The server connection ended.");
                        }
                        if (!await availableTask) return;

                        while (snapshots.TryRead(out var snapshot))
                        {
                            diagnostics.TryRecordSampled("normalized", "normalized.ndjson", snapshot);
                            var payload = JsonSerializer.SerializeToUtf8Bytes(new { type = "telemetry.update", payload = snapshot }, JsonOptions);
                            var sendTask = SendAsync(socket, payload, sendGate, connectionCancellation.Token);
                            completedTask = await Task.WhenAny(sendTask, receiveTask);
                            if (completedTask == receiveTask)
                            {
                                connectionCancellation.Cancel();
                                await receiveTask;
                            }
                            await sendTask;
                            UpdateStatus(current => current with
                            {
                                Streaming = true,
                                LastTelemetryAt = DateTimeOffset.UtcNow,
                                LastError = null
                            });
                        }
                    }
                }
                finally
                {
                    await connectionCancellation.CancelAsync();
                    try { await receiveTask; }
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

    private static async Task SendAsync(ClientWebSocket socket, ReadOnlyMemory<byte> payload, SemaphoreSlim sendGate, CancellationToken cancellationToken)
    {
        await sendGate.WaitAsync(cancellationToken);
        try
        {
            await WithTimeoutAsync(
                token => socket.SendAsync(payload, WebSocketMessageType.Text, true, token).AsTask(),
                SendTimeout,
                "Sending telemetry to the server timed out.",
                cancellationToken);
        }
        finally
        {
            sendGate.Release();
        }
    }

    private async Task MonitorServerAsync(ClientWebSocket socket, ICameraController? cameraController, SemaphoreSlim sendGate, CancellationToken cancellationToken)
    {
        var buffer = new byte[8_192];
        while (!cancellationToken.IsCancellationRequested)
        {
            using var messageBuffer = new MemoryStream();
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
                messageBuffer.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            using var document = JsonDocument.Parse(messageBuffer.ToArray());
            if (!document.RootElement.TryGetProperty("type", out var type) || type.GetString() != "camera.command") continue;
            if (!document.RootElement.TryGetProperty("command", out var commandElement)) continue;
            var command = commandElement.Deserialize<CameraSwitchCommand>(JsonOptions);
            if (command is null) continue;
            var resultMessage = cameraController?.SendCamera(command)
                ?? new CameraCommandResult(false, "Camera rejected — this telemetry source cannot control iRacing");
            diagnostics.TryRecord("events.ndjson", new { type = "camera.command", command.Id, command.CarNumber, command.CameraGroup, command.Camera, resultMessage.Sent, resultMessage.Message });
            WriteLog(resultMessage.Message);
            var response = JsonSerializer.SerializeToUtf8Bytes(new
            {
                type = "camera.result",
                commandId = command.Id,
                status = resultMessage.Sent ? "sent" : "rejected",
                message = resultMessage.Message
            }, JsonOptions);
            await SendAsync(socket, response, sendGate, cancellationToken);
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
