using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using RaceControl.TelemetryClient;

var serverArg = Array.IndexOf(args, "--server");
var server = serverArg >= 0 && serverArg + 1 < args.Length ? args[serverArg + 1] : "ws://localhost:8787/socket";
var ibtArg = Array.IndexOf(args, "--ibt");
var ibtPath = ibtArg >= 0 && ibtArg + 1 < args.Length ? args[ibtArg + 1] : null;
var simulate = args.Contains("--simulate", StringComparer.OrdinalIgnoreCase);
using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; shutdown.Cancel(); };

await using ITelemetrySource source = simulate ? new SimulatedTelemetrySource() : new IracingSdkTelemetrySource(ibtPath);
var serializerOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

Console.WriteLine($"Telemetry client starting — source: {(simulate ? "simulation" : ibtPath is null ? "live iRacing SDK" : $"IBT playback ({ibtPath})")}");
Console.WriteLine($"Server: {server}");

while (!shutdown.IsCancellationRequested)
{
    using var socket = new ClientWebSocket();
    try
    {
        await socket.ConnectAsync(new Uri(server), shutdown.Token);
        Console.WriteLine("Connected. Streaming telemetry; press Ctrl+C to stop.");

        var hello = JsonSerializer.SerializeToUtf8Bytes(new { type = "hello", role = "telemetry", clientId = Environment.MachineName }, serializerOptions);
        await socket.SendAsync(hello, WebSocketMessageType.Text, true, shutdown.Token);

        await foreach (var snapshot in source.ReadAsync(shutdown.Token))
        {
            var payload = JsonSerializer.SerializeToUtf8Bytes(new { type = "telemetry.update", payload = snapshot }, serializerOptions);
            await socket.SendAsync(payload, WebSocketMessageType.Text, true, shutdown.Token);
        }
    }
    catch (OperationCanceledException) when (shutdown.IsCancellationRequested) { }
    catch (Exception error)
    {
        Console.Error.WriteLine($"Connection lost: {error.Message}. Retrying in 2 seconds…");
        try { await Task.Delay(TimeSpan.FromSeconds(2), shutdown.Token); } catch (OperationCanceledException) { }
    }
}
