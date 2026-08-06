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
        CancellationToken cancellationToken)
    {
        var endpoint = BuildTelemetryUri(options.ServerUrl);
        while (!cancellationToken.IsCancellationRequested && await snapshots.WaitToReadAsync(cancellationToken))
        {
            using var socket = new ClientWebSocket();
            try
            {
                socket.Options.SetRequestHeader("Authorization", $"Bearer {options.IngestionKey}");
                WriteLog($"Connecting to {endpoint.Host}…");
                await socket.ConnectAsync(endpoint, cancellationToken);
                UpdateStatus(current => current with { ServerConnected = true, LastError = null });
                diagnostics.TryRecord("events.ndjson", new { type = "server.connected", endpoint = endpoint.Host });
                WriteLog("Server connected.");

                var hello = JsonSerializer.SerializeToUtf8Bytes(new
                {
                    type = "hello",
                    role = "telemetry",
                    clientId = Environment.MachineName
                }, JsonOptions);
                await socket.SendAsync(hello, WebSocketMessageType.Text, true, cancellationToken);

                while (await snapshots.WaitToReadAsync(cancellationToken))
                {
                    while (snapshots.TryRead(out var snapshot))
                    {
                        diagnostics.TryRecordSampled("normalized", "normalized.ndjson", snapshot);
                        var payload = JsonSerializer.SerializeToUtf8Bytes(new { type = "telemetry.update", payload = snapshot }, JsonOptions);
                        await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
                        UpdateStatus(current => current with
                        {
                            Streaming = true,
                            LastTelemetryAt = DateTimeOffset.UtcNow,
                            LastError = null
                        });
                    }
                }
                return;
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
