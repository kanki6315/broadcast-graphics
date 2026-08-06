using System.Threading.Channels;
using Microsoft.Extensions.Logging.Abstractions;
using SVappsLAB.iRacingTelemetrySDK;

namespace RaceControl.TelemetryClient;

public interface ITelemetrySource : IAsyncDisposable
{
    IAsyncEnumerable<SessionState> ReadAsync(CancellationToken cancellationToken);
}

public sealed class SimulatedTelemetrySource : ITelemetrySource
{
    private static readonly string[] Names = ["Maya Anderson", "Jon Bell", "Riley Patterson", "Alejandra Garcia", "Bryn Thompson", "Dev Morris"];

    public async IAsyncEnumerable<SessionState> ReadAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var tick = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            tick++;
            var drivers = Names.Select((name, index) => new DriverState(
                index, index + 1, (23 + index * 7).ToString(), name, $"Team {index + 1}", "GT3",
                index == 0 ? null : index * 0.72 + Math.Sin(tick / 8d + index) * 0.15,
                81.4 + index * 0.22 + Math.Sin(tick / 7d + index) * 0.2,
                81.1 + index * 0.22, 18, false, index % 3)).ToArray();

            yield return new SessionState("client-sim", "Telemetry client simulation", "race", "Virginia International Raceway — Full Course", 18, 40, null, "green", DateTimeOffset.UtcNow.ToString("O"), drivers);
            await Task.Delay(250, cancellationToken);
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

[RequiredTelemetryVars([
    TelemetryVar.SessionNum,
    TelemetryVar.SessionTime,
    TelemetryVar.SessionTimeRemain,
    TelemetryVar.SessionLapsTotal,
    TelemetryVar.SessionFlags,
    TelemetryVar.Lap,
    TelemetryVar.CarIdxPosition,
    TelemetryVar.CarIdxF2Time,
    TelemetryVar.CarIdxLapCompleted,
    TelemetryVar.CarIdxLastLapTime,
    TelemetryVar.CarIdxBestLapTime,
    TelemetryVar.CarIdxOnPitRoad
])]
public sealed class IracingSdkTelemetrySource(string? ibtPath = null) : ITelemetrySource
{
    public async IAsyncEnumerable<SessionState> ReadAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        // This boundary intentionally keeps the vendor SDK out of transport and presentation code.
        var snapshots = Channel.CreateBounded<SessionState>(new BoundedChannelOptions(4)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        using var monitorCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        IBTOptions? ibtOptions = ibtPath is null ? null : new IBTOptions(ibtPath, playBackSpeedMultiplier: 1);
        await using var client = TelemetryClient<TelemetryData>.Create(NullLogger.Instance, ibtOptions);

        TelemetrySessionInfo? sessionInfo = null;
        long lastSnapshotTick = 0;
        var handlers = new TelemetryHandlers<TelemetryData>
        {
            OnSessionInfoUpdate = update =>
            {
                Volatile.Write(ref sessionInfo, update);
                return Task.CompletedTask;
            },
            OnTelemetryUpdate = telemetry =>
            {
                var now = System.Diagnostics.Stopwatch.GetTimestamp();
                if (lastSnapshotTick != 0 &&
                    System.Diagnostics.Stopwatch.GetElapsedTime(lastSnapshotTick, now) < TimeSpan.FromMilliseconds(100))
                    return Task.CompletedTask;

                var session = Volatile.Read(ref sessionInfo);
                if (session is not null)
                {
                    lastSnapshotTick = now;
                    snapshots.Writer.TryWrite(MapSnapshot(telemetry, session));
                }
                return Task.CompletedTask;
            },
            OnConnectStateChanged = state =>
            {
                Console.WriteLine($"iRacing SDK: {state}");
                return Task.CompletedTask;
            },
            OnError = error =>
            {
                Console.Error.WriteLine($"iRacing SDK error: {error.Message}");
                return Task.CompletedTask;
            }
        };

        var monitorTask = MonitorAsync(client, handlers, snapshots.Writer, monitorCancellation.Token);
        try
        {
            await foreach (var snapshot in snapshots.Reader.ReadAllAsync(cancellationToken))
                yield return snapshot;
        }
        finally
        {
            await monitorCancellation.CancelAsync();
            try { await monitorTask; } catch (OperationCanceledException) { }
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static async Task MonitorAsync(
        ITelemetryClient<TelemetryData> client,
        TelemetryHandlers<TelemetryData> handlers,
        ChannelWriter<SessionState> writer,
        CancellationToken cancellationToken)
    {
        try
        {
            await client.Monitor(handlers, cancellationToken);
            writer.TryComplete();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            writer.TryComplete();
        }
        catch (Exception error)
        {
            writer.TryComplete(error);
        }
    }

    private static SessionState MapSnapshot(TelemetryData telemetry, TelemetrySessionInfo info)
    {
        var sessionNumber = telemetry.SessionNum ?? info.SessionInfo?.CurrentSessionNum ?? 0;
        var session = info.SessionInfo?.Sessions?.FirstOrDefault(item => item.SessionNum == sessionNumber);
        var results = session?.ResultsPositions?.ToDictionary(item => item.CarIdx) ?? [];
        var drivers = (info.DriverInfo?.Drivers ?? [])
            .Where(driver => driver.CarIdx >= 0 && driver.CarIsPaceCar == 0 && driver.IsSpectator == 0)
            .Select(driver => MapDriver(driver, telemetry, results))
            .OrderBy(driver => driver.Position <= 0 ? int.MaxValue : driver.Position)
            .ToArray();

        var weekend = info.WeekendInfo;
        var trackName = weekend?.TrackDisplayName;
        if (string.IsNullOrWhiteSpace(trackName))
            trackName = weekend?.TrackName;

        return new SessionState(
            $"{weekend?.SubSessionID ?? 0}-{sessionNumber}",
            session?.SessionName ?? weekend?.EventType ?? "iRacing session",
            NormalizeSessionType(session?.SessionType ?? weekend?.EventType),
            trackName ?? "Unknown track",
            Math.Max(telemetry.Lap ?? 0, 0),
            NormalizeTotalLaps(telemetry.SessionLapsTotal),
            NormalizeTime(telemetry.SessionTimeRemain),
            NormalizeFlag(telemetry.SessionFlags),
            DateTimeOffset.UtcNow.ToString("O"),
            drivers);
    }

    private static DriverState MapDriver(
        Driver driver,
        TelemetryData telemetry,
        IReadOnlyDictionary<int, Session.ResultPosition> results)
    {
        var index = driver.CarIdx;
        results.TryGetValue(index, out var result);

        return new DriverState(
            index,
            ValueAt(telemetry.CarIdxPosition, index),
            driver.CarNumber ?? string.Empty,
            driver.UserName ?? driver.AbbrevName ?? $"Car {driver.CarNumber}",
            driver.TeamName ?? string.Empty,
            driver.CarClassShortName ?? driver.CarScreenNameShort ?? string.Empty,
            NormalizeTime(ValueAt(telemetry.CarIdxF2Time, index)),
            NormalizeTime(ValueAt(telemetry.CarIdxLastLapTime, index)),
            NormalizeTime(ValueAt(telemetry.CarIdxBestLapTime, index)),
            Math.Max(ValueAt(telemetry.CarIdxLapCompleted, index), 0),
            ValueAt(telemetry.CarIdxOnPitRoad, index),
            result?.Incidents ?? Math.Max(driver.TeamIncidentCount, driver.CurDriverIncidentCount));
    }

    private static int ValueAt(int[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length ? values[index] : 0;

    private static float? ValueAt(float[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length ? values[index] : null;

    private static bool ValueAt(bool[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length && values[index];

    private static double? NormalizeTime(double? value) =>
        value is >= 0 && double.IsFinite(value.Value) ? value : null;

    private static int? NormalizeTotalLaps(int? laps) => laps is > 0 and < 32767 ? laps : null;

    private static string NormalizeSessionType(string? type)
    {
        var normalized = type?.ToLowerInvariant() ?? string.Empty;
        if (normalized.Contains("race")) return "race";
        if (normalized.Contains("qual")) return "qualifying";
        return "practice";
    }

    private static string NormalizeFlag(SessionFlags? flags)
    {
        if (flags?.HasFlag(SessionFlags.Red) == true) return "red";
        if (flags?.HasFlag(SessionFlags.Checkered) == true) return "checkered";
        if (flags?.HasFlag(SessionFlags.Caution) == true ||
            flags?.HasFlag(SessionFlags.CautionWaving) == true ||
            flags?.HasFlag(SessionFlags.Yellow) == true ||
            flags?.HasFlag(SessionFlags.YellowWaving) == true) return "yellow";
        if (flags?.HasFlag(SessionFlags.White) == true) return "white";
        return "green";
    }
}
