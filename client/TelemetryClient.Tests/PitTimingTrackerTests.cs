using System.IO.Compression;
using System.Text.Json;
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

        var gap = Assert.Single(tracker.GetGaps(7));
        Assert.Equal(100, gap.StartTime);
        Assert.Equal(110, gap.EndTime);
        Assert.Equal(10, gap.Duration);
        Assert.Equal("pit-stall", gap.StateBefore);
        Assert.Equal("pit-stall", gap.StateAfter);
        Assert.Equal("inferred-box-time", gap.Classification);
        Assert.Equal("pit-stall observed before and after the missing interval", gap.Reason);
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

        var gap = Assert.Single(tracker.GetGaps(7));
        Assert.Equal(before, gap.StateBefore);
        Assert.Equal(after, gap.StateAfter);
        Assert.Equal("unknown-time", gap.Classification);
        Assert.Equal("missing interval was not bracketed by pit-stall observations", gap.Reason);
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
        Assert.True(Assert.Single(tracker.GetGaps(7)).DriverChange);
    }

    [Fact]
    public void OpenAndNonPitGapsRemainAvailableForDiagnostics()
    {
        var tracker = new PitTimingTracker();

        Apply(tracker, 100, "not-in-pits");
        Apply(tracker, 105, "unobserved");

        var open = Assert.Single(tracker.GetGaps(7));
        Assert.Null(open.EndTime);
        Assert.Equal(5, open.Duration);
        Assert.Equal("not-in-pits", open.StateBefore);
        Assert.Null(open.StateAfter);
        Assert.Equal("unresolved-unknown-time", open.Classification);
        Assert.Equal("car is still unobserved", open.Reason);

        Apply(tracker, 110, "not-in-pits");
        var resolved = Assert.Single(tracker.GetGaps(7));
        Assert.Equal(110, resolved.EndTime);
        Assert.Equal("not-in-pits", resolved.StateAfter);
        Assert.Equal("unknown-timing-gap", resolved.Classification);
        Assert.Equal("car was unobserved away from a pit visit", resolved.Reason);
    }

    [Fact]
    public void RetainedGapHistoryIsBoundedPerCar()
    {
        var tracker = new PitTimingTracker();
        Apply(tracker, 0, "not-in-pits");
        for (var index = 0; index < 65; index++)
        {
            Apply(tracker, index * 3 + 1, "unobserved");
            Apply(tracker, index * 3 + 2, "not-in-pits");
        }

        var gaps = tracker.GetGaps(7);
        Assert.Equal(64, gaps.Count);
        Assert.Equal(2, gaps[0].StartTime);
        Assert.Equal(194, gaps[^1].EndTime);
    }

    [Fact]
    public void TerminalFramesDoNotAdvanceAnOpenPitVisit()
    {
        var tracker = new PitTimingTracker();

        Apply(tracker, 100, "pit-lane");
        var racing = Apply(tracker, 105, "pit-lane");
        var checkered = Assert.Single(tracker.Apply(
            "session", 115, [Driver("pit-lane", 41)], freeze: true));
        var coolDown = Assert.Single(tracker.Apply(
            "session", 130, [Driver("unobserved", 41)], freeze: true));

        Assert.Equal(5, racing.LatestPitVisit!.PitLaneTime);
        Assert.Equal(5, checkered.LatestPitVisit!.PitLaneTime);
        Assert.Equal(5, coolDown.LatestPitVisit!.PitLaneTime);
        Assert.Equal(0, coolDown.LatestPitVisit.UnknownTime);
        Assert.Empty(tracker.GetGaps(7));
    }

    [Fact]
    public async Task DiagnosticCapturePersistsOpenAndResolvedGapEvidence()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"gantry-pit-gap-{Guid.NewGuid():N}");
        var archivePath = Path.Combine(directory, "capture.zip");
        Directory.CreateDirectory(directory);
        try
        {
            await using var diagnostics = new DiagnosticCapture();
            await diagnostics.StartAsync(new DiagnosticCaptureOptions(archivePath, 30, null));
            var tracker = new PitTimingTracker(gap => diagnostics.TryRecord("pit-gaps.ndjson", gap));

            Apply(tracker, 100, "pit-stall");
            Apply(tracker, 105, "unobserved", 41);
            Apply(tracker, 110, "pit-stall", 42);
            var result = await diagnostics.StopAsync("test complete");

            Assert.NotNull(result);
            Assert.Null(result.Error);
            using var archive = ZipFile.OpenRead(archivePath);
            var entry = archive.GetEntry("pit-gaps.ndjson");
            Assert.NotNull(entry);
            using var reader = new StreamReader(entry.Open());
            var records = new List<JsonElement>();
            while (await reader.ReadLineAsync() is { } line)
                records.Add(JsonDocument.Parse(line).RootElement.Clone());

            Assert.Equal(2, records.Count);
            Assert.Equal("unresolved-unknown-time", records[0].GetProperty("payload").GetProperty("classification").GetString());
            var resolved = records[1].GetProperty("payload");
            Assert.Equal("inferred-box-time", resolved.GetProperty("classification").GetString());
            Assert.True(resolved.GetProperty("driverChange").GetBoolean());
            Assert.Equal("pit-stall", resolved.GetProperty("stateBefore").GetString());
            Assert.Equal("pit-stall", resolved.GetProperty("stateAfter").GetString());
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
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
