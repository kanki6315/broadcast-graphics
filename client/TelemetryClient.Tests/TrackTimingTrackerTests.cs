using Xunit;

namespace RaceControl.TelemetryClient;

public sealed class TrackTimingTrackerTests
{
    private static readonly SectorDefinition ThreeSectors = Definition((1, 0), (2, .3), (3, .7));

    [Fact]
    public void PreservesMovingGapInterpolationWhileHistoryWarmsUp()
    {
        var tracker = new TrackTimingTracker();
        tracker.Observe("race", 100, [Driver(0, 5, .2), Driver(1, 5, .1)]);
        Assert.Null(tracker.GetGapAtPosition(0, Driver(1, 5, .2), 100));

        tracker.Observe("race", 101, [Driver(0, 5, .3), Driver(1, 5, .2)]);

        AssertClose(1, tracker.GetGapAtPosition(0, Driver(1, 5, .2), 101));
        AssertClose(100.5, tracker.GetCrossingTime(0, 4.25));
    }

    [Fact]
    public void InterpolatesAcrossStartFinishAndSupportsVariableSectorCounts()
    {
        var tracker = new TrackTimingTracker();
        Observe(tracker, 10, Driver(0, 1, .95), ThreeSectors);
        Observe(tracker, 11, Driver(0, 2, .05), ThreeSectors);
        Observe(tracker, 13.5, Driver(0, 2, .35), ThreeSectors);
        Observe(tracker, 16.5, Driver(0, 2, .75), ThreeSectors);
        Observe(tracker, 19, Driver(0, 3, .05, lastLap: 8.0833), ThreeSectors);

        var lap = tracker.GetCompletedSectorTimes(0).Where(sector => sector.LapNumber == 2).ToArray();
        Assert.Equal(3, lap.Length);
        Assert.All(lap, sector => Assert.Equal("valid", sector.Quality));
        Assert.Equal([1, 2, 3], lap.Select(sector => sector.SectorNumber));
        AssertClose(8.0833, lap.Sum(sector => sector.Value));
        var timing = Assert.IsType<DriverSectorTiming>(tracker.GetSectorTiming(0, 3));
        Assert.Equal([1, 2, 3], timing.BestSectors!.Select(sector => sector.SectorNumber));
        Assert.All(timing.BestSectors!, sector => Assert.Contains("personal-best", sector.Comparisons!));
    }

    [Fact]
    public void IndexesPersonalClassAndOverallFastestSectorsOnlyWhenResultsChange()
    {
        var tracker = new TrackTimingTracker();
        var drivers = new[]
        {
            Driver(0, 1, .95) with { ClassId = 1 },
            Driver(1, 1, .95) with { ClassId = 1 },
            Driver(2, 1, .95) with { ClassId = 2 }
        };
        tracker.Observe("race", 0, drivers, ThreeSectors);
        tracker.Observe("race", 1,
        [
            drivers[0] with { CurrentLap = 2, LapDistPct = .05 },
            drivers[1] with { CurrentLap = 2, LapDistPct = .02 },
            drivers[2] with { CurrentLap = 2, LapDistPct = .01 }
        ], ThreeSectors);
        tracker.Observe("race", 2.5,
        [
            drivers[0] with { CurrentLap = 2, LapDistPct = .35 },
            drivers[1] with { CurrentLap = 2, LapDistPct = .35 },
            drivers[2] with { CurrentLap = 2, LapDistPct = .35 }
        ], ThreeSectors);

        var car0 = Assert.Single(tracker.GetCompletedSectorTimes(0));
        var car1 = Assert.Single(tracker.GetCompletedSectorTimes(1));
        var car2 = Assert.Single(tracker.GetCompletedSectorTimes(2));
        Assert.Equal(["personal-best"], car0.Comparisons);
        Assert.Equal(["personal-best", "class-fastest"], car1.Comparisons);
        Assert.Equal(["personal-best", "class-fastest", "overall-fastest"], car2.Comparisons);

        tracker.Observe("race", 2.6,
        [
            drivers[0] with { CurrentLap = 2, LapDistPct = .36 },
            drivers[1] with { CurrentLap = 2, LapDistPct = .36 },
            drivers[2] with { CurrentLap = 2, LapDistPct = .36 }
        ], ThreeSectors);

        Assert.Same(car0, Assert.Single(tracker.GetCompletedSectorTimes(0)));
        Assert.Same(car1, Assert.Single(tracker.GetCompletedSectorTimes(1)));
        Assert.Same(car2, Assert.Single(tracker.GetCompletedSectorTimes(2)));
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("lap-jump")]
    [InlineData("position-reset")]
    [InlineData("tow")]
    [InlineData("pit-transition")]
    [InlineData("session-transition")]
    public void NeverInterpolatesACompletedSectorAcrossDiscontinuity(string kind)
    {
        var tracker = new TrackTimingTracker();
        Observe(tracker, 1, Driver(0, 1, .95), ThreeSectors);
        Observe(tracker, 2, Driver(0, 2, .05), ThreeSectors);

        switch (kind)
        {
            case "missing": tracker.Observe("race", 2.5, [], ThreeSectors); break;
            case "lap-jump": Observe(tracker, 2.5, Driver(0, 4, .1), ThreeSectors); break;
            case "position-reset": Observe(tracker, 2.5, Driver(0, 1, .2), ThreeSectors); break;
            case "tow": Observe(tracker, 2.5, Driver(0, 2, .1) with { TrackStatus = "not-in-world", IsConnected = false }, ThreeSectors); break;
            case "pit-transition": Observe(tracker, 2.5, Driver(0, 2, .1) with { PitState = "pit-lane", OnPitRoad = true }, ThreeSectors); break;
            case "session-transition": tracker.Observe("race-2", 2.5, [Driver(0, 2, .1)], ThreeSectors with { SessionId = "race-2" }); break;
        }

        var session = kind == "session-transition" ? "race-2" : "race";
        var definition = ThreeSectors with { SessionId = session };
        tracker.Observe(session, 3, [Driver(0, kind == "lap-jump" ? 4 : 2, .2)], definition);
        tracker.Observe(session, 4, [Driver(0, kind == "lap-jump" ? 4 : 2, .35)], definition);
        tracker.Observe(session, 5, [Driver(0, kind == "lap-jump" ? 4 : 2, .75)], definition);

        Assert.DoesNotContain(tracker.GetCompletedSectorTimes(0), sector => sector.Quality == "valid" && sector.Value > 1.5);
    }

    [Fact]
    public void SparseBoundarySamplesAreIncompleteAndCannotBecomeFastest()
    {
        var tracker = new TrackTimingTracker();
        Observe(tracker, 0, Driver(0, 1, .95), ThreeSectors);
        Observe(tracker, 3, Driver(0, 2, .05), ThreeSectors);
        Observe(tracker, 7, Driver(0, 2, .35), ThreeSectors);

        var result = Assert.Single(tracker.GetCompletedSectorTimes(0));
        Assert.Equal("incomplete", result.Quality);
        Assert.Equal("insufficient-samples", result.Reason);
        Assert.Null(result.Value);
        Assert.Null(result.Comparisons);
    }

    [Fact]
    public void LapReconciliationRejectsDerivedSectorsWithoutTouchingOfficialLap()
    {
        var tracker = new TrackTimingTracker();
        Observe(tracker, 10, Driver(0, 1, .95), ThreeSectors);
        Observe(tracker, 11, Driver(0, 2, .05), ThreeSectors);
        Observe(tracker, 13.5, Driver(0, 2, .35), ThreeSectors);
        Observe(tracker, 16.5, Driver(0, 2, .75), ThreeSectors);
        var official = Driver(0, 3, .05, lastLap: 20);
        Observe(tracker, 19, official, ThreeSectors);
        Observe(tracker, 21.1, official with { LapDistPct = .1 }, ThreeSectors);

        var sectors = tracker.GetCompletedSectorTimes(0).Where(sector => sector.LapNumber == 2).ToArray();
        Assert.All(sectors, sector =>
        {
            Assert.Equal("invalid", sector.Quality);
            Assert.Equal("definition-mismatch", sector.Reason);
            Assert.Null(sector.Value);
        });
        Assert.Equal(20, official.LastLap);
    }

    [Fact]
    public void LapReconciliationWaitsForLastLapTimeToCatchUpWithCompletedLapNumber()
    {
        var tracker = new TrackTimingTracker();
        Observe(tracker, 10, Driver(0, 1, .95), ThreeSectors);
        Observe(tracker, 11, Driver(0, 2, .05), ThreeSectors);
        Observe(tracker, 13.5, Driver(0, 2, .35), ThreeSectors);
        Observe(tracker, 16.5, Driver(0, 2, .75), ThreeSectors);

        // At start/finish iRacing has advanced the completed-lap counter, but
        // LastLap still belongs to the preceding lap for this one frame.
        Observe(tracker, 19, Driver(0, 3, .05, lastLap: 7), ThreeSectors);
        var waiting = tracker.GetCompletedSectorTimes(0).Where(sector => sector.LapNumber == 2).ToArray();
        Assert.All(waiting, sector => Assert.Equal("valid", sector.Quality));

        Observe(tracker, 19.1, Driver(0, 3, .06, lastLap: 8.0833), ThreeSectors);
        var reconciled = tracker.GetCompletedSectorTimes(0).Where(sector => sector.LapNumber == 2).ToArray();
        Assert.Equal(3, reconciled.Length);
        Assert.All(reconciled, sector => Assert.Equal("valid", sector.Quality));
        AssertClose(8.0833, reconciled.Sum(sector => sector.Value));
    }

    [Fact]
    public void DefinitionRevisionChangeClearsRankingsAndSectorLifecycle()
    {
        var tracker = new TrackTimingTracker();
        Observe(tracker, 1, Driver(0, 1, .95), ThreeSectors);
        Observe(tracker, 2, Driver(0, 2, .05), ThreeSectors);
        Observe(tracker, 3, Driver(0, 2, .35), ThreeSectors);
        var revised = ThreeSectors with { Revision = "revision-2", Boundaries = [new(1, 0), new(2, .5)] };

        Observe(tracker, 4, Driver(0, 2, .55), revised);

        Assert.Empty(tracker.GetCompletedSectorTimes(0));
    }

    private static void Observe(TrackTimingTracker tracker, double time, DriverState driver, SectorDefinition definition) =>
        tracker.Observe(definition.SessionId, time, [driver], definition);

    private static DriverState Driver(int carIdx, int lap, double pct, double? lastLap = null) => new(
        carIdx, carIdx + 1, (carIdx + 1).ToString(), $"Driver {carIdx}", $"Team {carIdx}", "GT3",
        null, lastLap, lastLap, Math.Max(lap - 1, 0), false, 0)
    {
        ClassId = 1,
        ClassPosition = carIdx + 1,
        CurrentLap = lap,
        LastLapNumber = lastLap is null ? null : lap - 1,
        LapDistPct = pct,
        TrackStatus = "running",
        PitState = "not-in-pits",
        IsConnected = true,
        UserId = 100 + carIdx,
    };

    private static SectorDefinition Definition(params (int number, double start)[] sectors) =>
        new("revision-1", "iracing", "race", 1, "Test Track", sectors.Select(sector => new SectorBoundary(sector.number, sector.start)).ToArray());

    private static void AssertClose(double expected, double? actual) => Assert.InRange(actual ?? double.NaN, expected - .001, expected + .001);
}
