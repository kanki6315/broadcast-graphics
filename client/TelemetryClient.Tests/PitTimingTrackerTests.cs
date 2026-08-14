using Xunit;

namespace RaceControl.TelemetryClient;

public sealed class PitTimingTrackerTests
{
    [Fact]
    public void StallMissingStallIsTheOnlyGapInferredAsBoxTime()
    {
        var tracker = new PitTimingTracker();

        Apply(tracker, 100, "pit-stall");
        var missing = Apply(tracker, 105, "unobserved");
        var returned = Apply(tracker, 110, "pit-stall");

        Assert.Equal(5, missing.LatestPitVisit!.UnknownTime);
        Assert.Equal("incomplete", missing.LatestPitVisit.Quality);
        Assert.Equal(10, returned.LatestPitVisit!.InferredBoxTime);
        Assert.Equal(10, returned.LatestPitVisit.BoxTime);
        Assert.Equal(0, returned.LatestPitVisit.UnknownTime);
        Assert.Equal(0, returned.LatestPitVisit.ObservedBoxTime);
    }

    [Theory]
    [InlineData("pit-stall", "pit-lane")]
    [InlineData("pit-stall", "not-in-pits")]
    [InlineData("pit-lane", "pit-lane")]
    [InlineData("pit-lane", "pit-stall")]
    [InlineData("pit-lane", "not-in-pits")]
    public void EveryOtherPitRelatedMissingIntervalRemainsUnknown(string before, string after)
    {
        var tracker = new PitTimingTracker();

        Apply(tracker, 100, before);
        Apply(tracker, 105, "unobserved");
        var returned = Apply(tracker, 110, after);

        Assert.Equal(0, returned.LatestPitVisit!.InferredBoxTime);
        Assert.Equal(0, returned.LatestPitVisit.BoxTime);
        Assert.Equal(10, returned.LatestPitVisit.UnknownTime);
        Assert.Equal("incomplete", returned.LatestPitVisit.Quality);
        Assert.Equal(after == "not-in-pits" ? 110 : null, returned.LatestPitVisit.PitExitTime);
    }

    [Fact]
    public void ObservedAndInferredBoxTimeReconcileWithoutOverlap()
    {
        var tracker = new PitTimingTracker();

        Apply(tracker, 100, "pit-lane");
        Apply(tracker, 104, "pit-stall");
        Apply(tracker, 109, "pit-stall");
        Apply(tracker, 112, "unobserved");
        Apply(tracker, 119, "pit-stall");
        Apply(tracker, 123, "pit-lane");
        var completed = Apply(tracker, 128, "not-in-pits");

        var visit = completed.LatestPitVisit!;
        Assert.Equal(9, visit.PitLaneTime);
        Assert.Equal(9, visit.ObservedBoxTime);
        Assert.Equal(10, visit.InferredBoxTime);
        Assert.Equal(19, visit.BoxTime);
        Assert.Equal(0, visit.UnknownTime);
        Assert.Equal(28, visit.PitExitTime - visit.PitEntryTime);
        Assert.Equal(visit.PitExitTime - visit.PitEntryTime, visit.PitLaneTime + visit.BoxTime + visit.UnknownTime);
        Assert.Equal("contains-inference", visit.Quality);
    }

    [Fact]
    public void DriverChangeDuringMissingTimeDoesNotSplitTheVisit()
    {
        var tracker = new PitTimingTracker();

        Apply(tracker, 100, "pit-stall", 41);
        Apply(tracker, 105, "unobserved", 42);
        var returned = Apply(tracker, 110, "pit-stall", 42);
        var completed = Apply(tracker, 115, "not-in-pits", 42);

        Assert.True(returned.LatestPitVisit!.DriverChange);
        Assert.Equal("41", completed.LatestPitVisit!.EntryDriverId);
        Assert.Equal("42", completed.LatestPitVisit.ExitDriverId);
        Assert.Equal(100, completed.LatestPitVisit.PitEntryTime);
        Assert.Equal(115, completed.LatestPitVisit.PitExitTime);
    }

    private static DriverState Apply(PitTimingTracker tracker, double time, string pitState, int userId = 41) =>
        Assert.Single(tracker.Apply("session", time, [Driver(pitState, userId)]));

    private static DriverState Driver(string pitState, int userId) => new DriverState(
        7, 1, "23", "Driver", "Team", "GT3", null, null, null, 0, pitState != "not-in-pits", 0)
    {
        PitState = pitState,
        UserId = userId,
        IsConnected = pitState != "unobserved"
    };
}
