namespace RaceControl.TelemetryClient;

/// <summary>
/// Owns the single high-frequency distance/time history used by moving gaps and
/// native-sector timing. Discontinuities advance a continuity generation so no
/// interpolation can bridge missing or implausible telemetry.
/// </summary>
internal sealed class TrackTimingTracker
{
    private const double MaximumHistorySeconds = 180;
    private const double MaximumGapSeconds = 180;
    // iRacing is normally sampled much faster, but three seconds tolerates
    // diagnostic/replay cadence without interpolating across a material gap.
    private const double MaximumBoundarySampleSeconds = 3;
    private const double MaterialTelemetryGapSeconds = 5;
    private const double MaximumPlausibleLapsPerSecond = 0.25;
    private const double LapReconciliationMinimumSeconds = 0.5;
    private const double LapReconciliationFraction = 0.01;
    private readonly Dictionary<int, CarHistory> cars = [];
    private string? sessionId;
    private string? definitionRevision;
    private double lastSessionTime = double.NegativeInfinity;
    private SectorDefinition? definition;

    public void Observe(
        string currentSessionId,
        double? sessionTime,
        IReadOnlyList<DriverState> drivers,
        SectorDefinition? sectorDefinition = null)
    {
        if (sessionTime is null || !double.IsFinite(sessionTime.Value)) return;
        var sessionChanged = !string.Equals(sessionId, currentSessionId, StringComparison.Ordinal) ||
            sessionTime.Value + 1 < lastSessionTime;
        var revisionChanged = definitionRevision is not null && sectorDefinition?.Revision != definitionRevision;
        if (sessionChanged || revisionChanged)
        {
            cars.Clear();
            sessionId = currentSessionId;
        }

        definition = sectorDefinition;
        definitionRevision = sectorDefinition?.Revision;
        lastSessionTime = sessionTime.Value;
        var observedCars = drivers.Select(driver => driver.CarIdx).ToHashSet();
        foreach (var history in cars.Where(pair => !observedCars.Contains(pair.Key)).Select(pair => pair.Value))
            history.Missing = true;

        foreach (var driver in drivers)
        {
            if (!cars.TryGetValue(driver.CarIdx, out var history))
            {
                history = new CarHistory();
                cars[driver.CarIdx] = history;
            }

            var distance = RaceDistance(driver);
            var usable = distance is not null && driver.IsConnected &&
                driver.PitState is not "pit-lane" and not "pit-stall" and not "unobserved" &&
                !driver.OnPitRoad && driver.TrackStatus is not "not-in-world" and not "retired";
            if (!usable)
            {
                var reason = driver.OnPitRoad || driver.PitState is "pit-lane" or "pit-stall"
                    ? "pit-transition"
                    : driver.TrackStatus == "not-in-world" ? "tow" : "telemetry-gap";
                Invalidate(history, reason);
                history.Missing = true;
                continue;
            }

            var invalidReason = DiscontinuityReason(history, driver, distance!.Value, sessionTime.Value);
            if (invalidReason is not null) Invalidate(history, invalidReason);

            var sample = new TrackSample(
                distance.Value,
                sessionTime.Value,
                driver.CurrentLap,
                driver.LapDistPct!.Value,
                history.Generation);
            if (history.Samples.Count > 0 && invalidReason is null)
            {
                var previous = history.Samples[^1];
                if (Math.Abs(sample.Distance - previous.Distance) < 0.000_001)
                {
                    history.Missing = false;
                    history.LastDriver = driver;
                    continue;
                }
                CompleteCrossings(history, previous, sample, driver);
            }

            history.Samples.Add(sample);
            history.Missing = false;
            history.LastDriver = driver;
            Trim(history.Samples, sessionTime.Value);
            ReconcileCompletedLap(history, driver);
        }

        RefreshComparisons(drivers);
    }

    public double? GetCrossingTime(int carIdx, double absoluteDistance)
    {
        if (!cars.TryGetValue(carIdx, out var history)) return null;
        return Crossing(history.Samples, absoluteDistance)?.SessionTime;
    }

    public double? GetGapAtPosition(int referenceCarIdx, DriverState driver, double? sessionTime)
    {
        var targetDistance = RaceDistance(driver);
        if (targetDistance is null || sessionTime is null || !cars.TryGetValue(referenceCarIdx, out var history))
            return null;
        var crossing = Crossing(history.Samples, targetDistance.Value);
        if (crossing is null) return null;
        var gap = sessionTime.Value - crossing.SessionTime;
        return gap is >= 0 and <= MaximumGapSeconds && double.IsFinite(gap) ? gap : null;
    }

    public IReadOnlyList<CompletedSector> GetCompletedSectorTimes(int carIdx) =>
        cars.TryGetValue(carIdx, out var history) ? history.Completed.ToArray() : [];

    public DriverSectorTiming? GetSectorTiming(int carIdx, int currentLap)
    {
        if (definition is null || !cars.TryGetValue(carIdx, out var history)) return null;
        var current = history.Completed.Where(result => result.LapNumber == currentLap).OrderBy(result => result.SectorNumber).ToArray();
        var previous = history.Completed.Where(result => result.LapNumber == currentLap - 1).OrderBy(result => result.SectorNumber).ToArray();
        return new DriverSectorTiming(CurrentSector(history), current, previous);
    }

    private static string? DiscontinuityReason(CarHistory history, DriverState driver, double distance, double time)
    {
        if (history.Missing) return "telemetry-gap";
        if (history.Samples.Count == 0 || history.LastDriver is null) return null;
        var previous = history.Samples[^1];
        var elapsed = time - previous.SessionTime;
        if (elapsed <= 0) return "position-reset";
        if (driver.CurrentLap > previous.LapNumber + 1) return "lap-jump";
        if (driver.CurrentLap < previous.LapNumber) return "position-reset";
        if (distance + 0.05 < previous.Distance) return "position-reset";
        if (distance - previous.Distance > Math.Max(0.25, elapsed * MaximumPlausibleLapsPerSecond)) return "implausible-movement";
        if (elapsed > MaterialTelemetryGapSeconds) return "telemetry-gap";
        if (history.LastDriver.OnPitRoad != driver.OnPitRoad || history.LastDriver.PitState != driver.PitState) return "pit-transition";
        return null;
    }

    private static void Invalidate(CarHistory history, string reason)
    {
        if (history.PendingInvalidReason is null) history.PendingInvalidReason = reason;
        history.Generation++;
        history.Samples.Clear();
        history.LastCrossing = null;
    }

    private void CompleteCrossings(CarHistory history, TrackSample before, TrackSample after, DriverState driver)
    {
        if (definition is null || definition.Boundaries.Count < 2 || before.Generation != after.Generation) return;
        var crossings = BoundariesBetween(before.Distance, after.Distance, definition.Boundaries).ToArray();
        foreach (var boundary in crossings)
        {
            var crossing = Interpolate(before, after, boundary.AbsoluteDistance);
            var closeEnough = after.SessionTime - before.SessionTime <= MaximumBoundarySampleSeconds;
            if (history.LastCrossing is { } start)
            {
                var expected = NextSector(start.SectorNumber, definition.Boundaries);
                var quality = "valid";
                string? reason = null;
                double? value = crossing.SessionTime - start.SessionTime;
                if (boundary.SectorNumber != expected)
                {
                    quality = "invalid";
                    reason = "invalid-crossing-order";
                    value = null;
                }
                else if (!closeEnough || start.Generation != crossing.Generation)
                {
                    quality = "incomplete";
                    reason = "insufficient-samples";
                    value = null;
                }
                else if (history.PendingInvalidReason is not null)
                {
                    quality = "invalid";
                    reason = history.PendingInvalidReason;
                    value = null;
                }

                var lapNumber = (int)Math.Floor(start.AbsoluteDistance) + 1;
                Upsert(history.Completed, new CompletedSector(
                    driver.CarIdx,
                    lapNumber,
                    start.SectorNumber,
                    definition.Revision,
                    "derived",
                    quality,
                    value,
                    reason,
                    after.SessionTime,
                    crossing.SessionTime,
                    driver.UserId > 0 ? driver.UserId.ToString() : driver.Name,
                    driver.Name));
                history.PendingInvalidReason = null;
            }
            else if (!closeEnough && history.PendingInvalidReason is null)
            {
                history.PendingInvalidReason = "insufficient-samples";
            }
            history.LastCrossing = crossing with { SectorNumber = boundary.SectorNumber };
        }
    }

    private void ReconcileCompletedLap(CarHistory history, DriverState driver)
    {
        if (definition is null || driver.LastLapNumber is not { } lap || driver.LastLap is not { } official || official <= 0) return;
        if (!history.ReconciledLaps.Add(lap)) return;
        var results = history.Completed.Where(result => result.LapNumber == lap && result.DefinitionRevision == definition.Revision).ToArray();
        if (results.Length != definition.Boundaries.Count || results.Any(result => result.Quality != "valid" || result.Value is null)) return;
        var sum = results.Sum(result => result.Value!.Value);
        var tolerance = Math.Max(LapReconciliationMinimumSeconds, official * LapReconciliationFraction);
        if (Math.Abs(sum - official) <= tolerance) return;
        for (var index = 0; index < history.Completed.Count; index++)
        {
            var result = history.Completed[index];
            if (result.LapNumber == lap && result.DefinitionRevision == definition.Revision)
                history.Completed[index] = result with { Value = null, Quality = "invalid", Reason = "definition-mismatch", Comparisons = null };
        }
    }

    private void RefreshComparisons(IReadOnlyList<DriverState> drivers)
    {
        if (definition is null) return;
        var classByCar = drivers.ToDictionary(driver => driver.CarIdx, driver => driver.ClassId);
        var all = cars.Values.SelectMany(history => history.Completed)
            .Where(result => result.DefinitionRevision == definition.Revision && result.Quality == "valid" && result.Value is not null)
            .ToArray();
        foreach (var history in cars.Values)
        {
            for (var index = 0; index < history.Completed.Count; index++)
            {
                var result = history.Completed[index];
                if (result.Quality != "valid" || result.Value is null || result.DefinitionRevision != definition.Revision) continue;
                var comparisons = new List<string>();
                if (IsFastest(result, all.Where(candidate => candidate.CarIdx == result.CarIdx))) comparisons.Add("personal-best");
                if (classByCar.TryGetValue(result.CarIdx, out var classId) &&
                    IsFastest(result, all.Where(candidate => classByCar.GetValueOrDefault(candidate.CarIdx) == classId))) comparisons.Add("class-fastest");
                if (IsFastest(result, all)) comparisons.Add("overall-fastest");
                history.Completed[index] = result with { Comparisons = comparisons };
            }
        }
    }

    private static bool IsFastest(CompletedSector result, IEnumerable<CompletedSector> candidates)
    {
        var fastest = candidates.Where(candidate => candidate.SectorNumber == result.SectorNumber)
            .MinBy(candidate => candidate.Value);
        return fastest?.Value is not null && Math.Abs(fastest.Value.Value - result.Value!.Value) < 0.000_5;
    }

    private static IEnumerable<BoundaryCrossing> BoundariesBetween(double before, double after, IReadOnlyList<SectorBoundary> boundaries)
    {
        var firstLap = (int)Math.Floor(before) - 1;
        var lastLap = (int)Math.Floor(after) + 1;
        for (var lap = firstLap; lap <= lastLap; lap++)
        foreach (var boundary in boundaries)
        {
            var distance = lap + boundary.StartPct;
            if (distance > before + 0.000_001 && distance <= after + 0.000_001)
                yield return new BoundaryCrossing(boundary.SectorNumber, distance);
        }
    }

    private static int NextSector(int sectorNumber, IReadOnlyList<SectorBoundary> boundaries)
    {
        var index = boundaries.ToList().FindIndex(boundary => boundary.SectorNumber == sectorNumber);
        return boundaries[(index + 1 + boundaries.Count) % boundaries.Count].SectorNumber;
    }

    private int? CurrentSector(CarHistory history)
    {
        if (definition is null || history.LastCrossing is null) return null;
        return history.LastCrossing.SectorNumber;
    }

    private static TrackCrossing Interpolate(TrackSample before, TrackSample after, double distance)
    {
        var progress = (distance - before.Distance) / (after.Distance - before.Distance);
        return new TrackCrossing(distance, before.SessionTime + (after.SessionTime - before.SessionTime) * progress, before.Generation, 0);
    }

    private static TrackCrossing? Crossing(IReadOnlyList<TrackSample> samples, double distance)
    {
        for (var index = samples.Count - 2; index >= 0; index--)
        {
            var before = samples[index];
            var after = samples[index + 1];
            if (before.Generation != after.Generation || before.Distance > distance || after.Distance < distance) continue;
            if (after.Distance <= before.Distance || after.SessionTime - before.SessionTime > MaximumBoundarySampleSeconds) return null;
            return Interpolate(before, after, distance);
        }
        return null;
    }

    private static void Trim(List<TrackSample> samples, double sessionTime)
    {
        var minimum = sessionTime - MaximumHistorySeconds;
        var removeCount = samples.FindIndex(sample => sample.SessionTime >= minimum);
        if (removeCount > 0) samples.RemoveRange(0, removeCount);
    }

    private static void Upsert(List<CompletedSector> results, CompletedSector result)
    {
        var index = results.FindIndex(existing => existing.LapNumber == result.LapNumber &&
            existing.SectorNumber == result.SectorNumber && existing.DefinitionRevision == result.DefinitionRevision);
        if (index >= 0) results[index] = result;
        else results.Add(result);
        if (results.Count > 128) results.RemoveRange(0, results.Count - 128);
    }

    private static double? RaceDistance(DriverState driver) =>
        driver.CurrentLap > 0 && driver.LapDistPct is >= 0 and < 1.5
            ? driver.CurrentLap - 1 + driver.LapDistPct.Value
            : null;

    private sealed class CarHistory
    {
        public List<TrackSample> Samples { get; } = [];
        public List<CompletedSector> Completed { get; } = [];
        public HashSet<int> ReconciledLaps { get; } = [];
        public DriverState? LastDriver { get; set; }
        public TrackCrossing? LastCrossing { get; set; }
        public string? PendingInvalidReason { get; set; }
        public int Generation { get; set; }
        public bool Missing { get; set; }
    }

    private sealed record TrackSample(double Distance, double SessionTime, int LapNumber, double LapDistPct, int Generation);
    private sealed record TrackCrossing(double AbsoluteDistance, double SessionTime, int Generation, int SectorNumber);
    private sealed record BoundaryCrossing(int SectorNumber, double AbsoluteDistance);
}
