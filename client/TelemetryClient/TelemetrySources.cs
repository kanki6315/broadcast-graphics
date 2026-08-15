using System.Threading.Channels;
using Microsoft.Extensions.Logging.Abstractions;
using SVappsLAB.iRacingTelemetrySDK;
using SVappsLAB.iRacingTelemetrySDK.SimControl;

namespace RaceControl.TelemetryClient;

public interface ITelemetrySource : IAsyncDisposable
{
    event Action<bool, string>? ConnectionChanged;
    event Action? FrameObserved;
    event Action<string>? Log;
    IAsyncEnumerable<SessionState> ReadAsync(CancellationToken cancellationToken);
}

public interface ICameraController
{
    CameraCommandResult SendCamera(CameraSwitchCommand command);
}

public sealed class SimulatedTelemetrySource(DiagnosticCapture diagnostics) : ITelemetrySource
{
    private static readonly string[] Names = ["Maya Anderson", "Jon Bell", "Riley Patterson", "Alejandra Garcia", "Bryn Thompson", "Dev Morris"];
    public event Action<bool, string>? ConnectionChanged;
    public event Action? FrameObserved;
    public event Action<string>? Log;

    public async IAsyncEnumerable<SessionState> ReadAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        ConnectionChanged?.Invoke(true, "Simulation ready");
        Log?.Invoke("Simulated telemetry started.");
        diagnostics.TryRecord("events.ndjson", new { type = "simulation.started" });
        var tick = 0;
        var pitTiming = new PitTimingTracker(gap =>
        {
            if (gap.EndTime is null)
                diagnostics.TryRecordSampled($"pit-gap-{gap.SessionId}-{gap.CarIdx}", "pit-gaps.ndjson", gap);
            else
                diagnostics.TryRecord("pit-gaps.ndjson", gap);
        });
        var racePositions = new RacePositionTracker();
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                FrameObserved?.Invoke();
                tick++;
                var pitPhase = tick % 40;
                var drivers = Names.Select((name, index) =>
                {
                    var pitState = index != 5 ? "not-in-pits"
                        : pitPhase is >= 10 and < 15 ? "pit-stall"
                        : pitPhase is >= 15 and < 20 ? "unobserved"
                        : pitPhase is >= 20 and < 25 ? "pit-stall"
                        : pitPhase is >= 25 and < 30 ? "pit-lane"
                        : "not-in-pits";
                    var mapped = new DriverState(
                        index, index + 1, (23 + index * 7).ToString(), name, $"Team {index + 1}", "GT3",
                        index == 0 ? null : index * 0.72 + Math.Sin(tick / 8d + index) * 0.15,
                        81.4 + index * 0.22 + Math.Sin(tick / 7d + index) * 0.2,
                        81.1 + index * 0.22, 18, false, index % 3,
                        1, "#e54b2a", index + 1,
                        index == 0 ? 0 : index * 0.72,
                        index == 0 ? null : 0.72,
                        index == 0 ? 0 : index * 0.72,
                        index == 0 ? null : 0.72,
                        0, 0, 19, 18, 12, 0.42,
                        pitState is "pit-stall" or "pit-lane" ? "pit" : pitState == "unobserved" ? "not-in-world" : "running",
                        pitState != "unobserved");
                    return mapped with
                    {
                        PitState = pitState,
                        UserId = 1_000 + index,
                        TeamId = 2_000 + index,
                        CarId = 3_000 + index,
                        TimingQuality = new Dictionary<string, TimingQualityMetadata>
                        {
                            ["lapDistPct"] = new("derived", "valid"),
                            ["gapToLeader"] = new("derived", "valid"),
                            ["intervalToAhead"] = new("derived", index == 0 ? "incomplete" : "valid"),
                            ["classGapToLeader"] = new("derived", "valid"),
                            ["classIntervalToAhead"] = new("derived", index == 0 ? "incomplete" : "valid"),
                            ["lastLap"] = new("derived", "valid"),
                            ["bestLap"] = new("derived", "valid")
                        }
                    };
                }).ToArray();
                drivers = pitTiming.Apply("client-sim", tick / 4d, drivers);
                drivers = racePositions.Apply("client-sim", "race", "racing", drivers);

                yield return new SessionState(
                    "client-sim", "Telemetry client simulation", "race", "Virginia International Raceway — Full Course",
                    19, 40, null, "green", DateTimeOffset.UtcNow.ToString("O"), drivers,
                    18, 21, tick / 4d, null, "racing", "go", ["green"], [new CarClassState(1, "GT3", "#e54b2a", drivers.Length)],
                    "simulation", "simulation", null, null, null,
                    new SessionWeatherState("partly-cloudy", 25.56, 48.89, 3.58, 5.89, 30.38));
                await Task.Delay(250, cancellationToken);
            }
        }
        finally
        {
            ConnectionChanged?.Invoke(false, "Simulation stopped");
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

[RequiredTelemetryVars([
    TelemetryVar.SessionNum,
    TelemetryVar.SessionState,
    TelemetryVar.SessionTime,
    TelemetryVar.SessionTimeRemain,
    TelemetryVar.SessionTimeTotal,
    TelemetryVar.SessionLapsTotal,
    TelemetryVar.SessionLapsRemain,
    TelemetryVar.SessionFlags,
    TelemetryVar.Lap,
    TelemetryVar.CarIdxPosition,
    TelemetryVar.CarIdxClassPosition,
    TelemetryVar.CarIdxF2Time,
    TelemetryVar.CarIdxLap,
    TelemetryVar.CarIdxLapCompleted,
    TelemetryVar.CarIdxLapDistPct,
    TelemetryVar.CarIdxLastLapTime,
    TelemetryVar.CarIdxBestLapTime,
    TelemetryVar.CarIdxBestLapNum,
    TelemetryVar.CarIdxTrackSurface,
    TelemetryVar.CarIdxOnPitRoad,
    TelemetryVar.CamCarIdx,
    TelemetryVar.CamGroupNumber,
    TelemetryVar.CamCameraNumber,
    TelemetryVar.AirTemp,
    TelemetryVar.TrackTemp,
    TelemetryVar.WindVel,
    TelemetryVar.WindDir,
    TelemetryVar.RelativeHumidity,
    TelemetryVar.Skies
])]
public sealed class IracingSdkTelemetrySource(
    DiagnosticCapture diagnostics,
    Func<SectorDefinition?>? sectorDefinitionOverride = null) : ITelemetrySource, ICameraController
{
    private readonly object cameraGate = new();
    private ICameraCommands? cameraCommands;
    public event Action<bool, string>? ConnectionChanged;
    public event Action? FrameObserved;
    public event Action<string>? Log;

    public async IAsyncEnumerable<SessionState> ReadAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var snapshots = Channel.CreateBounded<SessionState>(new BoundedChannelOptions(4)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        using var monitorCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        await using var client = TelemetryClient<TelemetryData>.Create(NullLogger.Instance);
        lock (cameraGate) cameraCommands = client.SimControl.Camera;

        TelemetrySessionInfo? sessionInfo = null;
        var trackTiming = new TrackTimingTracker();
        var pitTiming = new PitTimingTracker(gap =>
        {
            if (gap.EndTime is null)
                diagnostics.TryRecordSampled($"pit-gap-{gap.SessionId}-{gap.CarIdx}", "pit-gaps.ndjson", gap);
            else
                diagnostics.TryRecord("pit-gaps.ndjson", gap);
        });
        var racePositions = new RacePositionTracker();
        string? latestRawSessionInfo = null;
        long lastSnapshotTick = 0;
        var handlers = new TelemetryHandlers<TelemetryData>
        {
            OnSessionInfoUpdate = update =>
            {
                Volatile.Write(ref sessionInfo, update);
                return Task.CompletedTask;
            },
            OnRawSessionInfoUpdate = yaml =>
            {
                Volatile.Write(ref latestRawSessionInfo, yaml);
                diagnostics.TryRecord("session-info.ndjson", new { yaml });
                return Task.CompletedTask;
            },
            OnTelemetryUpdate = telemetry =>
            {
                FrameObserved?.Invoke();
                diagnostics.TryRecordSampled("sdk-telemetry", "telemetry.ndjson", telemetry);
                diagnostics.TryRecordOnce("variable-inventory", "variables.ndjson", new
                {
                    variables = client.GetTelemetryVariables().Select(variable => new
                    {
                        type = variable.Type.FullName,
                        variable.Length,
                        variable.IsTimeValue,
                        variable.Name,
                        variable.Desc,
                        variable.Units
                    })
                });
                var rawSession = Volatile.Read(ref latestRawSessionInfo);
                if (rawSession is not null)
                    diagnostics.TryRecordOnce("initial-session-info", "session-info.ndjson", new { yaml = rawSession, initial = true });

                var now = System.Diagnostics.Stopwatch.GetTimestamp();
                if (lastSnapshotTick != 0 &&
                    System.Diagnostics.Stopwatch.GetElapsedTime(lastSnapshotTick, now) < TimeSpan.FromMilliseconds(100))
                    return Task.CompletedTask;

                var session = Volatile.Read(ref sessionInfo);
                if (session is not null)
                {
                    lastSnapshotTick = now;
                    var snapshot = TelemetrySnapshotMapper.Map(
                        telemetry,
                        session,
                        trackTiming: trackTiming,
                        pitTiming: pitTiming,
                        racePositions: racePositions,
                        sectorDefinitionOverride: sectorDefinitionOverride?.Invoke());
                    diagnostics.TryRecordSampled("normalized", "normalized.ndjson", snapshot);
                    snapshots.Writer.TryWrite(snapshot);
                }
                return Task.CompletedTask;
            },
            OnConnectStateChanged = state =>
            {
                var connected = string.Equals(state.ToString(), "Connected", StringComparison.OrdinalIgnoreCase);
                var label = $"iRacing SDK — {state}";
                ConnectionChanged?.Invoke(connected, label);
                Log?.Invoke(label);
                return Task.CompletedTask;
            },
            OnError = error =>
            {
                Log?.Invoke($"iRacing SDK error: {error.Message}");
                diagnostics.TryRecord("events.ndjson", new { type = "sdk.error", error = error.Message });
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
            lock (cameraGate) cameraCommands = null;
            await monitorCancellation.CancelAsync();
            try { await monitorTask; } catch (OperationCanceledException) { }
            ConnectionChanged?.Invoke(false, "iRacing SDK disconnected");
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    public CameraCommandResult SendCamera(CameraSwitchCommand command)
    {
        try
        {
            lock (cameraGate)
            {
                if (cameraCommands is null)
                    return new(false, "Camera rejected — the live iRacing source is not connected");
                cameraCommands.SwitchToCar(command.CarNumber, command.CameraGroup, command.Camera);
            }
            return new(true, $"Camera sent — #{command.CarNumber} / group {command.CameraGroup}");
        }
        catch (Exception error)
        {
            return new(false, $"Camera rejected — {error.Message}");
        }
    }

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

}

internal static class TelemetrySnapshotMapper
{
    public static SessionState Map(
        TelemetryData telemetry,
        TelemetrySessionInfo info,
        DateTimeOffset? capturedAt = null,
        TrackTimingTracker? trackTiming = null,
        PitTimingTracker? pitTiming = null,
        RacePositionTracker? racePositions = null,
        SectorDefinition? sectorDefinitionOverride = null)
    {
        var sessionNumber = telemetry.SessionNum ?? info.SessionInfo?.CurrentSessionNum ?? 0;
        var session = info.SessionInfo?.Sessions?.FirstOrDefault(item => item.SessionNum == sessionNumber);
        var results = session?.ResultsPositions?
            .GroupBy(item => item.CarIdx)
            .ToDictionary(group => group.Key, group => group.First()) ?? [];
        var sessionType = NormalizeSessionType(session?.SessionType ?? info.WeekendInfo?.EventType);
        var phase = NormalizePhase(telemetry.SessionState);
        var sessionId = $"{info.WeekendInfo?.SubSessionID ?? 0}-{sessionNumber}";
        var drivers = (info.DriverInfo?.Drivers ?? [])
            .Where(driver => driver.CarIdx >= 0 && driver.CarIsPaceCar == 0 && driver.IsSpectator == 0)
            .Select(driver => MapDriver(driver, telemetry, results, sessionType))
            .ToArray();
        drivers = AddLivePositions(drivers, sessionType, phase);
        var sessionTime = NormalizeTime(telemetry.SessionTime);
        if (pitTiming is not null)
            drivers = pitTiming.Apply(sessionId, sessionTime, drivers, phase is "checkered" or "cool-down");
        if (racePositions is not null) drivers = racePositions.Apply(sessionId, sessionType, phase, drivers);
        var weekend = info.WeekendInfo;
        var trackName = weekend?.TrackDisplayName;
        if (string.IsNullOrWhiteSpace(trackName)) trackName = weekend?.TrackName;
        var nativeSectorDefinition = MapSectorDefinition(info, sessionId, weekend?.TrackID, trackName ?? "Unknown track");
        var sectorDefinition = sectorDefinitionOverride is not null &&
            (sectorDefinitionOverride.TrackId is null || sectorDefinitionOverride.TrackId == weekend?.TrackID) &&
            string.Equals(sectorDefinitionOverride.TrackName, trackName ?? "Unknown track", StringComparison.OrdinalIgnoreCase)
                ? sectorDefinitionOverride with { SessionId = sessionId }
                : nativeSectorDefinition;
        trackTiming?.Observe(
            sessionId,
            sessionTime,
            drivers,
            sectorDefinition,
            sessionType,
            phase,
            weekend?.WeekendOptions?.StandingStart == 1);
        drivers = AddRaceTiming(drivers, sessionType, sessionTime, trackTiming)
            .Select(driver => driver with { Sectors = trackTiming?.GetSectorTiming(driver.CarIdx, driver.CurrentLap) })
            .ToArray();

        var leader = drivers.FirstOrDefault(driver => driver.Position == 1);
        var hasLiveLeader = telemetry.CarIdxPosition?.Contains(1) == true;
        var leaderLapsCompleted = Math.Max(leader?.LapsCompleted ?? session?.ResultsLapsComplete ?? 0, 0);
        var currentLap = CalculateCurrentLap(sessionType, phase, leader, hasLiveLeader, leaderLapsCompleted, telemetry.SessionLapsTotal);
        var classes = drivers
            .GroupBy(driver => new { driver.ClassId, driver.ClassName, driver.ClassColor })
            .Select(group => new CarClassState(group.Key.ClassId, group.Key.ClassName, group.Key.ClassColor, group.Count()))
            .OrderByDescending(carClass => carClass.CarCount)
            .ThenBy(carClass => carClass.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var flags = NormalizeFlags(telemetry.SessionFlags);
        var cameraGroups = (info.CameraInfo?.Groups ?? [])
            .Select(group => new CameraGroupDefinition(
                group.GroupNum,
                group.GroupName ?? $"Camera group {group.GroupNum}",
                group.IsScenic,
                (group.Cameras ?? []).Select(camera => new CameraDefinition(
                    camera.CameraNum,
                    camera.CameraName ?? $"Camera {camera.CameraNum}")).ToArray()))
            .OrderBy(group => group.Number)
            .ToArray();

        return new SessionState(
            sessionId,
            session?.SessionName ?? weekend?.EventType ?? "iRacing session",
            sessionType,
            trackName ?? "Unknown track",
            currentLap,
            NormalizeTotalLaps(telemetry.SessionLapsTotal),
            NormalizeTime(telemetry.SessionTimeRemain),
            NormalizeFlag(telemetry.SessionFlags),
            (capturedAt ?? DateTimeOffset.UtcNow).ToString("O"),
            drivers,
            leaderLapsCompleted,
            NormalizeRemainingLaps(telemetry.SessionLapsRemain),
            NormalizeTime(telemetry.SessionTime),
            NormalizeTime(telemetry.SessionTimeTotal),
            phase,
            NormalizeStartState(telemetry.SessionFlags),
            flags,
            classes,
            "iracing",
            "live",
            weekend?.SubSessionID,
            sessionNumber,
            weekend?.TrackID,
            MapWeather(telemetry),
            cameraGroups,
            telemetry.CamCarIdx,
            telemetry.CamGroupNumber,
            telemetry.CamCameraNumber,
            sectorDefinition);
    }

    private static SessionWeatherState? MapWeather(TelemetryData telemetry)
    {
        var airTemperature = NormalizeMeasurement(telemetry.AirTemp);
        var trackTemperature = NormalizeMeasurement(telemetry.TrackTemp);
        var windSpeed = NormalizeMeasurement(telemetry.WindVel);
        var windDirection = NormalizeMeasurement(telemetry.WindDir);
        var humidity = NormalizeMeasurement(telemetry.RelativeHumidity);
        var condition = NormalizeSkies(telemetry.Skies);
        if (airTemperature is null && trackTemperature is null && windSpeed is null &&
            windDirection is null && humidity is null && telemetry.Skies is null) return null;
        return new SessionWeatherState(condition, airTemperature, trackTemperature, windSpeed, windDirection, humidity);
    }

    private static SectorDefinition? MapSectorDefinition(
        TelemetrySessionInfo info,
        string sessionId,
        int? trackId,
        string trackName)
    {
        var boundaries = (info.SplitTimeInfo?.Sectors ?? [])
            .Where(sector => sector.SectorNum >= 0 && sector.SectorStartPct is >= 0 and < 1 && double.IsFinite(sector.SectorStartPct))
            .GroupBy(sector => sector.SectorNum)
            .Select(group => group.First())
            .OrderBy(sector => sector.SectorStartPct)
            .Select(sector => new SectorBoundary(sector.SectorNum, sector.SectorStartPct))
            .ToArray();
        if (boundaries.Length < 2 || boundaries[0].StartPct > 0.001 ||
            boundaries.Select(boundary => boundary.StartPct).Distinct().Count() != boundaries.Length)
            return null;

        var identity = $"{sessionId}|{trackId}|{trackName}|{string.Join(';', boundaries.Select(boundary => $"{boundary.SectorNumber}:{boundary.StartPct:F7}"))}";
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(identity));
        var revision = $"iracing-{Convert.ToHexString(hash)[..12].ToLowerInvariant()}";
        return new SectorDefinition(revision, "iracing", sessionId, trackId, trackName, boundaries);
    }

    private static string NormalizeSkies(int? skies) => skies switch
    {
        0 => "clear",
        1 => "partly-cloudy",
        _ => "cloudy"
    };

    private static double? NormalizeMeasurement(double? value) =>
        value is not null && double.IsFinite(value.Value) ? value : null;

    private static DriverState MapDriver(
        Driver driver,
        TelemetryData telemetry,
        IReadOnlyDictionary<int, Session.ResultPosition> results,
        string sessionType)
    {
        var index = driver.CarIdx;
        results.TryGetValue(index, out var result);
        var position = ValueAt(telemetry.CarIdxPosition, index);
        if (position <= 0 && result?.Position > 0) position = result.Position;
        var classPosition = ValueAt(telemetry.CarIdxClassPosition, index);
        if (classPosition <= 0 && result is not null) classPosition = result.ClassPosition + 1;
        var lapsCompleted = ValueAt(telemetry.CarIdxLapCompleted, index);
        if (lapsCompleted < 0 && result is not null) lapsCompleted = result.LapsComplete;
        var lastLap = NormalizeTime(ValueAt(telemetry.CarIdxLastLapTime, index)) ?? NormalizeTime(result?.LastTime);
        var bestLap = NormalizeTime(ValueAt(telemetry.CarIdxBestLapTime, index)) ?? NormalizeTime(result?.FastestTime);
        var currentLap = ValueAt(telemetry.CarIdxLap, index);
        if (currentLap <= 0 && lapsCompleted >= 0) currentLap = lapsCompleted + 1;
        var bestLapNumber = ValueAt(telemetry.CarIdxBestLapNum, index);
        if (bestLapNumber <= 0 && result?.FastestLap > 0) bestLapNumber = result.FastestLap;
        var trackLocation = ValueAt(telemetry.CarIdxTrackSurface, index);
        var onPitRoad = ValueAt(telemetry.CarIdxOnPitRoad, index);
        var trackStatus = NormalizeTrackStatus(trackLocation, onPitRoad, result?.ReasonOutStr, position);
        var pitState = NormalizePitState(trackLocation, onPitRoad);
        var lapDistance = NormalizeLapDistance(ValueAt(telemetry.CarIdxLapDistPct, index));
        int? lastLapNumber = lastLap is not null && lapsCompleted > 0 ? lapsCompleted : null;
        var hasMatchingResult = lastLapNumber is not null && result?.LapsComplete == lastLapNumber;
        var mapped = new DriverState(
            index,
            position,
            driver.CarNumber ?? string.Empty,
            driver.UserName ?? driver.AbbrevName ?? $"Car {driver.CarNumber}",
            driver.TeamName ?? string.Empty,
            driver.CarClassShortName ?? driver.CarScreenNameShort ?? string.Empty,
            NormalizeTime(ValueAt(telemetry.CarIdxF2Time, index)),
            lastLap,
            bestLap,
            Math.Max(lapsCompleted, 0),
            onPitRoad,
            result?.Incidents ?? Math.Max(driver.TeamIncidentCount, driver.CurDriverIncidentCount),
            driver.CarClassID,
            NormalizeColor(driver.CarClassColor),
            classPosition,
            null,
            null,
            null,
            null,
            0,
            0,
            Math.Max(currentLap, 0),
            lastLapNumber,
            bestLapNumber > 0 ? bestLapNumber : null,
            lapDistance,
            trackStatus,
            !string.Equals(trackStatus, "not-in-world", StringComparison.Ordinal),
            driver.UserID,
            driver.TeamID,
            driver.CarID,
            hasMatchingResult && result!.Position > 0 ? result.Position : null,
            hasMatchingResult && result!.ClassPosition >= 0 ? result.ClassPosition + 1 : null,
            hasMatchingResult && string.Equals(sessionType, "race", StringComparison.Ordinal) ? NormalizeGap(result!.Time) : null);
        return mapped with
        {
            PitState = pitState,
            TimingQuality = new Dictionary<string, TimingQualityMetadata>
            {
                ["lapDistPct"] = Quality("iracing", lapDistance),
                ["lastLap"] = Quality("iracing", lastLap),
                ["bestLap"] = Quality("iracing", bestLap)
            }
        };
    }

    private static DriverState[] AddLivePositions(DriverState[] drivers, string sessionType, string phase)
    {
        if (!string.Equals(sessionType, "race", StringComparison.Ordinal) ||
            !string.Equals(phase, "racing", StringComparison.Ordinal))
            return OrderByPosition(drivers);

        var updated = drivers.ToDictionary(driver => driver.CarIdx);
        var eligible = drivers
            .Where(driver => driver.Position > 0 && RaceDistance(driver) is not null &&
                driver.IsConnected && !string.Equals(driver.TrackStatus, "retired", StringComparison.Ordinal))
            .ToArray();

        var overallSlots = eligible.Select(driver => driver.Position).Order().ToArray();
        var overallOrder = eligible
            .OrderByDescending(driver => RaceDistance(driver))
            .ThenBy(driver => driver.Position)
            .ThenBy(driver => driver.CarIdx)
            .ToArray();
        for (var index = 0; index < overallOrder.Length; index++)
        {
            var driver = overallOrder[index];
            updated[driver.CarIdx] = updated[driver.CarIdx] with { Position = overallSlots[index] };
        }

        foreach (var classDrivers in eligible.Where(driver => driver.ClassPosition > 0).GroupBy(driver => driver.ClassId))
        {
            var classSlots = classDrivers.Select(driver => driver.ClassPosition).Order().ToArray();
            var classOrder = classDrivers
                .OrderByDescending(driver => RaceDistance(driver))
                .ThenBy(driver => driver.ClassPosition)
                .ThenBy(driver => driver.CarIdx)
                .ToArray();
            for (var index = 0; index < classOrder.Length; index++)
            {
                var driver = classOrder[index];
                updated[driver.CarIdx] = updated[driver.CarIdx] with { ClassPosition = classSlots[index] };
            }
        }

        return OrderByPosition(updated.Values);
    }

    private static DriverState[] OrderByPosition(IEnumerable<DriverState> drivers) => drivers
        .OrderBy(driver => driver.Position <= 0 ? int.MaxValue : driver.Position)
        .ThenBy(driver => driver.CarIdx)
        .ToArray();

    private static DriverState[] AddRaceTiming(
        DriverState[] drivers,
        string sessionType,
        double? sessionTime,
        TrackTimingTracker? trackTiming)
    {
        if (!string.Equals(sessionType, "race", StringComparison.Ordinal))
            return drivers.Select(driver => driver with { Interval = null }).ToArray();

        var ordered = drivers.Where(driver => driver.Position > 0).OrderBy(driver => driver.Position).ToArray();
        var leader = ordered.FirstOrDefault();
        if (leader is null) return drivers;
        var byPosition = ordered
            .GroupBy(driver => driver.Position)
            .ToDictionary(group => group.Key, group => group.First());
        var classLeaders = ordered
            .Where(driver => driver.ClassPosition > 0)
            .GroupBy(driver => driver.ClassId)
            .ToDictionary(group => group.Key, group => group.OrderBy(driver => driver.ClassPosition).First());
        var byClassPosition = ordered
            .Where(driver => driver.ClassPosition > 0)
            .GroupBy(driver => (driver.ClassId, driver.ClassPosition))
            .ToDictionary(group => group.Key, group => group.First());

        return drivers.Select(driver =>
        {
            var lapsBehind = CalculateLapsBehind(leader, driver);
            var derivedGap = driver.Position == leader.Position
                ? 0d
                : lapsBehind == 0
                    ? trackTiming?.GetGapAtPosition(leader.CarIdx, driver, sessionTime)
                    : null;
            var fallbackGap = driver.Position == leader.Position
                ? 0d
                : lapsBehind == 0
                    ? NormalizeGap(driver.Interval)
                    : null;
            var gap = derivedGap ?? fallbackGap;
            double? intervalToAhead = null;
            var intervalSource = "iracing";
            if (byPosition.TryGetValue(driver.Position - 1, out var ahead) && CalculateLapsBehind(ahead, driver) == 0)
            {
                var derivedInterval = trackTiming?.GetGapAtPosition(ahead.CarIdx, driver, sessionTime);
                intervalToAhead = derivedInterval
                    ?? Difference(NormalizeGap(driver.Interval), ahead.Position == leader.Position ? 0d : NormalizeGap(ahead.Interval));
                if (derivedInterval is not null) intervalSource = "derived";
            }

            classLeaders.TryGetValue(driver.ClassId, out var classLeader);
            var classLapsBehind = classLeader is null ? 0 : CalculateLapsBehind(classLeader, driver);
            var derivedClassGap = classLeader is null || driver.CarIdx == classLeader.CarIdx
                ? 0d
                : classLapsBehind == 0
                    ? trackTiming?.GetGapAtPosition(classLeader.CarIdx, driver, sessionTime)
                    : null;
            var fallbackClassGap = classLeader is null || driver.CarIdx == classLeader.CarIdx
                ? 0d
                : classLapsBehind == 0
                    ? Difference(NormalizeGap(driver.Interval), NormalizeGap(classLeader.Interval) ?? 0d)
                    : null;
            var classGap = derivedClassGap ?? fallbackClassGap;
            double? classInterval = null;
            var classIntervalSource = "iracing";
            if (byClassPosition.TryGetValue((driver.ClassId, driver.ClassPosition - 1), out var classAhead) &&
                CalculateLapsBehind(classAhead, driver) == 0)
            {
                classInterval = trackTiming?.GetGapAtPosition(classAhead.CarIdx, driver, sessionTime);
                if (classInterval is not null) classIntervalSource = "derived";
                if (classInterval is null)
                {
                    var aheadClassGap = classAhead.CarIdx == classLeader?.CarIdx
                        ? 0d
                        : Difference(NormalizeGap(classAhead.Interval), NormalizeGap(classLeader?.Interval) ?? 0d);
                    classInterval = Difference(classGap, aheadClassGap);
                }
            }

            int? lastLapLapsBehind = null;
            double? lastLapGap = null;
            int? lastLapClassLapsBehind = null;
            double? lastLapClassGap = null;
            if (driver.LastLapNumber is { } completedLap && driver.LastLapPosition is not null)
            {
                lastLapLapsBehind = Math.Max(leader.LapsCompleted - completedLap, 0);
                lastLapGap = lastLapLapsBehind == 0 ? driver.LastLapGapToLeader : null;
                if (classLeader?.LastLapNumber is { } classLeaderLap && classLeader.LastLapPosition is not null)
                {
                    lastLapClassLapsBehind = Math.Max(classLeaderLap - completedLap, 0);
                    if (lastLapClassLapsBehind == 0)
                    {
                        lastLapClassGap = driver.CarIdx == classLeader.CarIdx
                            ? 0d
                            : Difference(driver.LastLapGapToLeader, classLeader.LastLapGapToLeader);
                    }
                }
            }

            var timingQuality = driver.TimingQuality is null
                ? new Dictionary<string, TimingQualityMetadata>()
                : new Dictionary<string, TimingQualityMetadata>(driver.TimingQuality);
            timingQuality["gapToLeader"] = Quality(derivedGap is not null ? "derived" : "iracing", gap);
            timingQuality["intervalToAhead"] = Quality(intervalSource, intervalToAhead);
            timingQuality["classGapToLeader"] = Quality(derivedClassGap is not null ? "derived" : "iracing", classGap);
            timingQuality["classIntervalToAhead"] = Quality(classIntervalSource, classInterval);

            return driver with
            {
                Interval = gap,
                GapToLeader = gap,
                IntervalToAhead = intervalToAhead,
                ClassGapToLeader = classGap,
                ClassIntervalToAhead = classInterval,
                LapsBehindLeader = lapsBehind,
                LapsBehindClassLeader = classLapsBehind,
                LastLapGapToLeader = lastLapGap,
                LastLapGapToClassLeader = lastLapClassGap,
                LastLapLapsBehindLeader = lastLapLapsBehind,
                LastLapLapsBehindClassLeader = lastLapClassLapsBehind,
                TimingQuality = timingQuality
            };
        }).OrderBy(driver => driver.Position <= 0 ? int.MaxValue : driver.Position).ToArray();
    }

    private static int ValueAt(int[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length ? values[index] : 0;

    private static float? ValueAt(float[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length ? values[index] : null;

    private static bool ValueAt(bool[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length && values[index];

    private static TrackLocation? ValueAt(TrackLocation[]? values, int index) =>
        values is not null && index >= 0 && index < values.Length ? values[index] : null;

    private static double? NormalizeTime(double? value) =>
        value is >= 0 && double.IsFinite(value.Value) ? value : null;

    private static int? NormalizeTotalLaps(int? laps) => laps is > 0 and < 32767 ? laps : null;

    private static int? NormalizeRemainingLaps(int? laps) => laps is >= 0 and < 32767 ? laps : null;

    private static double? NormalizeGap(double? value) =>
        value is >= 0 && double.IsFinite(value.Value) ? value : null;

    private static double? Difference(double? value, double? baseline)
    {
        if (value is null || baseline is null) return null;
        var difference = value.Value - baseline.Value;
        return difference >= -0.001 ? Math.Max(difference, 0) : null;
    }

    private static int CalculateLapsBehind(DriverState reference, DriverState driver)
    {
        if (RaceDistance(reference) is { } referenceDistance && RaceDistance(driver) is { } driverDistance)
        {
            return Math.Max((int)Math.Floor(referenceDistance - driverDistance + 0.001), 0);
        }

        return Math.Max(reference.LapsCompleted - driver.LapsCompleted, 0);
    }

    private static double? RaceDistance(DriverState driver) =>
        driver.CurrentLap > 0 && driver.LapDistPct is >= 0 and < 1.5
            ? driver.CurrentLap - 1 + driver.LapDistPct.Value
            : null;

    private static double? NormalizeLapDistance(double? value) =>
        value is >= 0 and < 1.5 && double.IsFinite(value.Value) ? value : null;

    private static string NormalizeColor(int color) => $"#{(color & 0x00ffffff):x6}";

    private static string NormalizeSessionType(string? type)
    {
        var normalized = type?.ToLowerInvariant() ?? string.Empty;
        if (normalized.Contains("race")) return "race";
        if (normalized.Contains("qual")) return "qualifying";
        return "practice";
    }

    private static int CalculateCurrentLap(
        string sessionType,
        string phase,
        DriverState? leader,
        bool hasLiveLeader,
        int leaderLapsCompleted,
        int? totalLaps)
    {
        if (!string.Equals(sessionType, "race", StringComparison.Ordinal))
            return leader is null ? 0 : Math.Max(leader.CurrentLap, leaderLapsCompleted);
        if (leader is null || !hasLiveLeader || string.Equals(phase, "get-in-car", StringComparison.Ordinal) ||
            string.Equals(phase, "warmup", StringComparison.Ordinal) ||
            string.Equals(phase, "parade-laps", StringComparison.Ordinal)) return 0;

        var lap = leaderLapsCompleted + 1;
        var normalizedTotal = NormalizeTotalLaps(totalLaps);
        return normalizedTotal is { } total ? Math.Min(lap, total) : lap;
    }

    private static string NormalizePhase(SVappsLAB.iRacingTelemetrySDK.SessionState? state) => state switch
    {
        SVappsLAB.iRacingTelemetrySDK.SessionState.GetInCar => "get-in-car",
        SVappsLAB.iRacingTelemetrySDK.SessionState.Warmup => "warmup",
        SVappsLAB.iRacingTelemetrySDK.SessionState.ParadeLaps => "parade-laps",
        SVappsLAB.iRacingTelemetrySDK.SessionState.Racing => "racing",
        SVappsLAB.iRacingTelemetrySDK.SessionState.Checkered => "checkered",
        SVappsLAB.iRacingTelemetrySDK.SessionState.CoolDown => "cool-down",
        _ => "invalid"
    };

    private static string NormalizeStartState(SessionFlags? flags)
    {
        if (flags?.HasFlag(SessionFlags.StartGo) == true) return "go";
        if (flags?.HasFlag(SessionFlags.StartSet) == true) return "set";
        if (flags?.HasFlag(SessionFlags.StartReady) == true) return "ready";
        return "hidden";
    }

    private static IReadOnlyList<string> NormalizeFlags(SessionFlags? flags)
    {
        if (flags is null) return [];
        var normalized = new List<string>();
        Add(SessionFlags.Checkered, "checkered");
        Add(SessionFlags.White, "white");
        Add(SessionFlags.Green, "green");
        Add(SessionFlags.Yellow, "yellow");
        Add(SessionFlags.Red, "red");
        Add(SessionFlags.Blue, "blue");
        Add(SessionFlags.Debris, "debris");
        Add(SessionFlags.Crossed, "crossed");
        Add(SessionFlags.YellowWaving, "yellow-waving");
        Add(SessionFlags.OneLapToGreen, "one-lap-to-green");
        Add(SessionFlags.GreenHeld, "green-held");
        Add(SessionFlags.TenToGo, "ten-to-go");
        Add(SessionFlags.FiveToGo, "five-to-go");
        Add(SessionFlags.Caution, "caution");
        Add(SessionFlags.CautionWaving, "caution-waving");
        Add(SessionFlags.Black, "black");
        Add(SessionFlags.Disqualify, "disqualify");
        Add(SessionFlags.Repair, "repair");
        return normalized;

        void Add(SessionFlags value, string label)
        {
            if (flags.Value.HasFlag(value)) normalized.Add(label);
        }
    }

    private static string NormalizeTrackStatus(
        TrackLocation? location,
        bool onPitRoad,
        string? resultReason,
        int position)
    {
        if (!string.IsNullOrWhiteSpace(resultReason) &&
            !string.Equals(resultReason, "Running", StringComparison.OrdinalIgnoreCase)) return "retired";
        if (onPitRoad || location is TrackLocation.InPitStall or TrackLocation.AproachingPits) return "pit";
        if (location == TrackLocation.OffTrack) return "off-track";
        if (location == TrackLocation.NotInWorld) return "not-in-world";
        if (location == TrackLocation.OnTrack || position > 0) return "running";
        return "unknown";
    }

    private static string NormalizePitState(TrackLocation? location, bool onPitRoad)
    {
        if (location == TrackLocation.NotInWorld) return "unobserved";
        if (location == TrackLocation.InPitStall) return "pit-stall";
        if (onPitRoad || location == TrackLocation.AproachingPits) return "pit-lane";
        return "not-in-pits";
    }

    private static TimingQualityMetadata Quality(string source, double? value) =>
        new(source, value is null ? "incomplete" : "valid");

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
