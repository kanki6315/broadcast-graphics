using SVappsLAB.iRacingTelemetrySDK;
using Xunit;

namespace RaceControl.TelemetryClient;

public sealed class TelemetrySnapshotMapperTests
{
    [Fact]
    public void RaceUsesLeaderCompletedLapsAndDerivesGapsAndIntervals()
    {
        var telemetry = Telemetry(
            positions: [3, 2, 1, 4],
            classPositions: [3, 2, 1, 4],
            lapsCompleted: [56, 56, 56, 55],
            f2Times: [0.7f, 0.5f, 0, 21]);

        var state = TelemetrySnapshotMapper.Map(telemetry, SessionInfo(
            "Race", [Driver(0), Driver(1), Driver(2), Driver(3)]));

        Assert.Equal(57, state.Lap);
        Assert.Equal(56, state.LapsCompleted);
        Assert.Equal("racing", state.Phase);
        Assert.Equal("go", state.StartState);
        Assert.Contains("green", state.Flags!);
        Assert.Equal("iracing", state.Source);
        Assert.Equal("live", state.SourceMode);
        Assert.Equal(123, state.ExternalSubSessionId);
        Assert.Equal(0, state.ExternalSessionNumber);

        var leader = state.Drivers.Single(driver => driver.Position == 1);
        var second = state.Drivers.Single(driver => driver.Position == 2);
        var third = state.Drivers.Single(driver => driver.Position == 3);
        var lapped = state.Drivers.Single(driver => driver.Position == 4);
        Assert.Equal(0, leader.GapToLeader);
        AssertClose(0.5, second.GapToLeader);
        AssertClose(0.5, second.IntervalToAhead);
        AssertClose(0.7, third.GapToLeader);
        AssertClose(0.2, third.IntervalToAhead);
        Assert.Equal(1, lapped.LapsBehindLeader);
        Assert.Null(lapped.GapToLeader);
    }

    [Fact]
    public void MulticlassRaceDerivesClassOrderAndClassRelativeGaps()
    {
        var telemetry = Telemetry(
            positions: [1, 2, 3, 4],
            classPositions: [0, 0, 0, 0],
            lapsCompleted: [4, 4, 4, 4],
            f2Times: [0, 2, 3, 4]);
        var info = SessionInfo("Race",
            [Driver(0, 10, "GT"), Driver(1, 20, "TC"), Driver(2, 10, "GT"), Driver(3, 20, "TC")],
            [Result(0, 1, 0, 0), Result(1, 2, 0, 2), Result(2, 3, 1, 3), Result(3, 4, 1, 4)]);

        var state = TelemetrySnapshotMapper.Map(telemetry, info);

        Assert.Equal(2, state.Classes!.Count);
        var gtSecond = state.Drivers.Single(driver => driver.CarIdx == 2);
        var tcLeader = state.Drivers.Single(driver => driver.CarIdx == 1);
        var tcSecond = state.Drivers.Single(driver => driver.CarIdx == 3);
        Assert.Equal(2, gtSecond.ClassPosition);
        AssertClose(3, gtSecond.ClassGapToLeader);
        AssertClose(3, gtSecond.ClassIntervalToAhead);
        Assert.Equal(1, tcLeader.ClassPosition);
        Assert.Equal(0, tcLeader.ClassGapToLeader);
        Assert.Equal(2, tcSecond.ClassPosition);
        AssertClose(2, tcSecond.ClassGapToLeader);
        AssertClose(2, tcSecond.ClassIntervalToAhead);
        Assert.Equal(4, gtSecond.LastLapNumber);
        Assert.Equal(3, gtSecond.LastLapPosition);
        Assert.Equal(2, gtSecond.LastLapClassPosition);
        AssertClose(3, gtSecond.LastLapGapToLeader);
        AssertClose(3, gtSecond.LastLapGapToClassLeader);
        Assert.Equal(0, gtSecond.LastLapLapsBehindLeader);
        Assert.Equal(0, gtSecond.LastLapLapsBehindClassLeader);
    }

    [Fact]
    public void PracticeDoesNotMislabelF2FastestLapAsRaceGap()
    {
        var telemetry = Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [5, 5],
            f2Times: [81.2f, 81.7f]);

        var state = TelemetrySnapshotMapper.Map(telemetry, SessionInfo(
            "Practice", [Driver(0), Driver(1)]));

        Assert.Equal("practice", state.Type);
        Assert.All(state.Drivers, driver =>
        {
            Assert.Null(driver.Interval);
            Assert.Null(driver.GapToLeader);
            Assert.Null(driver.IntervalToAhead);
        });
    }

    [Fact]
    public void CautionAndLapTimingFieldsRemainExplicit()
    {
        var telemetry = Telemetry(
            positions: [1],
            classPositions: [1],
            lapsCompleted: [70],
            f2Times: [0],
            flags: SessionFlags.Caution | SessionFlags.OneLapToGreen | SessionFlags.StartReady,
            lastLapTimes: [68.234f],
            bestLapTimes: [67.111f],
            bestLapNumbers: [42],
            lapDistances: [0.52f]);

        var state = TelemetrySnapshotMapper.Map(telemetry, SessionInfo("Race", [Driver(0)]));
        var driver = Assert.Single(state.Drivers);

        Assert.Equal("yellow", state.Flag);
        Assert.Equal("ready", state.StartState);
        Assert.Contains("caution", state.Flags!);
        Assert.Contains("one-lap-to-green", state.Flags!);
        Assert.Equal(71, driver.CurrentLap);
        Assert.Equal(70, driver.LastLapNumber);
        Assert.Equal(42, driver.BestLapNumber);
        AssertClose(68.234, driver.LastLap);
        AssertClose(67.111, driver.BestLap);
        AssertClose(0.52, driver.LapDistPct);
        Assert.Equal("running", driver.TrackStatus);
    }

    [Fact]
    public void WeatherTelemetryIsNormalizedForTheBroadcastContract()
    {
        var telemetry = Telemetry(
            positions: [1],
            classPositions: [1],
            lapsCompleted: [1],
            f2Times: [0],
            airTemp: 25.5f,
            trackTemp: 48.9f,
            windVel: 3.6f,
            windDir: 5.89f,
            relativeHumidity: 30.38f,
            skies: 1);

        var state = TelemetrySnapshotMapper.Map(telemetry, SessionInfo("Practice", [Driver(0)]));

        Assert.NotNull(state.Weather);
        Assert.Equal("partly-cloudy", state.Weather.Condition);
        AssertClose(25.5, state.Weather.AirTemperatureC);
        AssertClose(48.9, state.Weather.TrackTemperatureC);
        AssertClose(3.6, state.Weather.WindSpeedMps);
        AssertClose(5.89, state.Weather.WindDirectionRadians);
        AssertClose(30.38, state.Weather.RelativeHumidityPercent);
    }

    [Fact]
    public void LiveTimingInterpolatesWhenCarsReachTheSameTrackPosition()
    {
        var timing = new LiveTimingTracker();
        var info = SessionInfo("Race", [Driver(0), Driver(1)]);

        TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [4, 4],
            f2Times: [0, 5],
            lapDistances: [0.20f, 0.10f],
            sessionTime: 100), info, liveTiming: timing);

        var secondFrame = TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [4, 4],
            f2Times: [0, 5],
            lapDistances: [0.30f, 0.20f],
            sessionTime: 101), info, liveTiming: timing);
        var second = secondFrame.Drivers.Single(driver => driver.Position == 2);
        AssertClose(1, second.GapToLeader);
        AssertClose(1, second.IntervalToAhead);

        var thirdFrame = TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [4, 4],
            f2Times: [0, 5],
            lapDistances: [0.40f, 0.29f],
            sessionTime: 102), info, liveTiming: timing);
        var updatedSecond = thirdFrame.Drivers.Single(driver => driver.Position == 2);
        AssertClose(1.1, updatedSecond.GapToLeader);
    }

    [Fact]
    public void LeaderCrossingTheLineDoesNotTemporarilyMarkTheFieldOneLapDown()
    {
        var state = TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [5, 4],
            f2Times: [0, 2.5f],
            lapDistances: [0.02f, 0.98f]), SessionInfo("Race", [Driver(0), Driver(1)]));

        var second = state.Drivers.Single(driver => driver.Position == 2);
        Assert.Equal(0, second.LapsBehindLeader);
        AssertClose(2.5, second.GapToLeader);
    }

    [Fact]
    public void LiveOrderAndGapFollowAnOvertakeBeforeScoringPositionUpdates()
    {
        var timing = new LiveTimingTracker();
        var info = SessionInfo("Race", [Driver(0), Driver(1)]);

        TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [4, 4],
            f2Times: [0, 5],
            lapDistances: [0.20f, 0.10f],
            sessionTime: 100), info, liveTiming: timing);

        var state = TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [4, 4],
            f2Times: [0, 5],
            lapDistances: [0.30f, 0.31f],
            sessionTime: 101), info, liveTiming: timing);

        Assert.Equal([1, 0], state.Drivers.Select(driver => driver.CarIdx));
        var newLeader = state.Drivers.Single(driver => driver.CarIdx == 1);
        var overtakenDriver = state.Drivers.Single(driver => driver.CarIdx == 0);
        Assert.Equal(1, newLeader.Position);
        Assert.Equal(1, newLeader.ClassPosition);
        Assert.Equal(2, overtakenDriver.Position);
        Assert.Equal(2, overtakenDriver.ClassPosition);
        AssertClose(0.048, overtakenDriver.GapToLeader);
        AssertClose(0.048, overtakenDriver.IntervalToAhead);
    }

    [Fact]
    public void CheckeredOrderRetainsTheSdkClassification()
    {
        var state = TelemetrySnapshotMapper.Map(Telemetry(
            positions: [1, 2],
            classPositions: [1, 2],
            lapsCompleted: [4, 4],
            f2Times: [0, 1],
            lapDistances: [0.40f, 0.45f],
            sessionState: SVappsLAB.iRacingTelemetrySDK.SessionState.Checkered),
            SessionInfo("Race", [Driver(0), Driver(1)]));

        Assert.Equal([0, 1], state.Drivers.Select(driver => driver.CarIdx));
        Assert.Equal(1, state.Drivers.Single(driver => driver.CarIdx == 0).Position);
    }

    private static TelemetryData Telemetry(
        int[] positions,
        int[] classPositions,
        int[] lapsCompleted,
        float[] f2Times,
        SessionFlags flags = SessionFlags.Green | SessionFlags.StartGo,
        float[]? lastLapTimes = null,
        float[]? bestLapTimes = null,
        int[]? bestLapNumbers = null,
        float[]? lapDistances = null,
        float? airTemp = null,
        float? trackTemp = null,
        float? windVel = null,
        float? windDir = null,
        float? relativeHumidity = null,
        int? skies = null,
        double sessionTime = 1_000,
        SVappsLAB.iRacingTelemetrySDK.SessionState sessionState = SVappsLAB.iRacingTelemetrySDK.SessionState.Racing) => new()
    {
        SessionNum = 0,
        SessionState = sessionState,
        SessionTime = sessionTime,
        SessionTimeRemain = 2_000,
        SessionTimeTotal = 3_000,
        SessionLapsTotal = 100,
        SessionLapsRemain = 44,
        SessionFlags = flags,
        Lap = 0,
        CarIdxPosition = positions,
        CarIdxClassPosition = classPositions,
        CarIdxF2Time = f2Times,
        CarIdxLap = lapsCompleted.Select(lap => lap + 1).ToArray(),
        CarIdxLapCompleted = lapsCompleted,
        CarIdxLapDistPct = lapDistances ?? Enumerable.Repeat(0.25f, positions.Length).ToArray(),
        CarIdxLastLapTime = lastLapTimes ?? Enumerable.Repeat(70f, positions.Length).ToArray(),
        CarIdxBestLapTime = bestLapTimes ?? Enumerable.Repeat(69f, positions.Length).ToArray(),
        CarIdxBestLapNum = bestLapNumbers ?? Enumerable.Repeat(3, positions.Length).ToArray(),
        CarIdxTrackSurface = Enumerable.Repeat(TrackLocation.OnTrack, positions.Length).ToArray(),
        CarIdxOnPitRoad = new bool[positions.Length],
        AirTemp = airTemp,
        TrackTemp = trackTemp,
        WindVel = windVel,
        WindDir = windDir,
        RelativeHumidity = relativeHumidity,
        Skies = skies
    };

    private static TelemetrySessionInfo SessionInfo(
        string type,
        IReadOnlyList<Driver> drivers,
        IReadOnlyList<Session.ResultPosition>? results = null) => new()
    {
        WeekendInfo = new WeekendInfo
        {
            SubSessionID = 123,
            EventType = type,
            TrackDisplayName = "Test Raceway"
        },
        SessionInfo = new SessionInfo
        {
            CurrentSessionNum = 0,
            Sessions =
            [
                new Session
                {
                    SessionNum = 0,
                    SessionName = type,
                    SessionType = type,
                    ResultsPositions = results?.ToList() ?? []
                }
            ]
        },
        DriverInfo = new DriverInfo { Drivers = drivers.ToList() }
    };

    private static Driver Driver(int carIdx, int classId = 10, string className = "Open") => new()
    {
        CarIdx = carIdx,
        UserName = $"Driver {carIdx}",
        TeamName = $"Team {carIdx}",
        CarNumber = (carIdx + 1).ToString(),
        CarClassID = classId,
        CarClassShortName = className,
        CarClassColor = classId == 10 ? 0xff0000 : 0x00ff00,
        UserID = 1_000 + carIdx,
        TeamID = 2_000 + carIdx,
        CarID = 3_000 + carIdx
    };

    private static Session.ResultPosition Result(int carIdx, int position, int classPosition, float time = 0) => new()
    {
        CarIdx = carIdx,
        Position = position,
        ClassPosition = classPosition,
        LapsComplete = 4,
        LastTime = 70,
        Time = time,
        ReasonOutStr = "Running"
    };

    private static void AssertClose(double expected, double? actual)
    {
        Assert.NotNull(actual);
        Assert.Equal(expected, actual.Value, 3);
    }
}
