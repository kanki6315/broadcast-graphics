using Xunit;

namespace RaceControl.TelemetryClient;

public sealed class RacePositionTrackerTests
{
    [Fact]
    public void CapturesRaceStartOnceAndDerivesPositiveGains()
    {
        var tracker = new RacePositionTracker();
        var start = tracker.Apply("race", "race", "racing", [Driver(4, 3, 0)]);
        var moved = tracker.Apply("race", "race", "racing", [Driver(2, 1, 2)]);

        Assert.Equal(4, start[0].StartingPosition);
        Assert.Equal(3, start[0].StartingClassPosition);
        Assert.Equal(2, moved[0].PositionChange);
        Assert.Equal(2, moved[0].ClassPositionChange);
    }

    [Fact]
    public void LateJoinBaselineRemainsUnavailableAcrossReconnectAndDriverChange()
    {
        var tracker = new RacePositionTracker();
        var late = tracker.Apply("race", "race", "racing", [Driver(4, 3, 5, 41)]);
        var changedDriver = tracker.Apply("race", "race", "racing", [Driver(3, 2, 6, 42)]);

        Assert.Null(late[0].StartingPosition);
        Assert.Null(changedDriver[0].StartingPosition);
        Assert.Null(changedDriver[0].PositionChange);
    }

    private static DriverState Driver(int position, int classPosition, int lapsCompleted, int userId = 41) =>
        new DriverState(7, position, "23", "Driver", "Team", "GT3", null, null, null, lapsCompleted, false, 0)
        {
            ClassPosition = classPosition,
            CurrentLap = lapsCompleted + 1,
            UserId = userId,
            IsConnected = true,
            PitState = "not-in-pits"
        };
}
