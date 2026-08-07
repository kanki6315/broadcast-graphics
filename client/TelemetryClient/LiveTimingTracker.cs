namespace RaceControl.TelemetryClient;

/// <summary>
/// Builds a moving time gap by comparing when two cars reach the same point on track.
/// iRacing's F2 gap remains the scoring fallback until enough position history exists.
/// </summary>
internal sealed class LiveTimingTracker
{
    private const double MaximumHistorySeconds = 180;
    private const double MaximumGapSeconds = 180;
    private readonly Dictionary<int, List<TrackSample>> samplesByCar = [];
    private string? sessionId;
    private double lastSessionTime = double.NegativeInfinity;

    public void Observe(string currentSessionId, double? sessionTime, IReadOnlyList<DriverState> drivers)
    {
        if (sessionTime is null || !double.IsFinite(sessionTime.Value)) return;
        if (!string.Equals(sessionId, currentSessionId, StringComparison.Ordinal) || sessionTime.Value + 1 < lastSessionTime)
        {
            samplesByCar.Clear();
            sessionId = currentSessionId;
        }

        lastSessionTime = sessionTime.Value;
        foreach (var driver in drivers)
        {
            var distance = RaceDistance(driver);
            if (distance is null || !driver.IsConnected) continue;
            if (!samplesByCar.TryGetValue(driver.CarIdx, out var samples))
            {
                samples = [];
                samplesByCar[driver.CarIdx] = samples;
            }

            if (samples.Count > 0)
            {
                var previous = samples[^1];
                if (distance.Value + 0.05 < previous.Distance || distance.Value > previous.Distance + 1.25)
                    samples.Clear();
                else if (Math.Abs(distance.Value - previous.Distance) < 0.000_001)
                    continue;
            }

            samples.Add(new TrackSample(distance.Value, sessionTime.Value));
            var minimumTime = sessionTime.Value - MaximumHistorySeconds;
            var removeCount = samples.FindIndex(sample => sample.SessionTime >= minimumTime);
            if (removeCount > 0) samples.RemoveRange(0, removeCount);
        }
    }

    public double? GapAtDriverPosition(int referenceCarIdx, DriverState driver, double? sessionTime)
    {
        var targetDistance = RaceDistance(driver);
        if (targetDistance is null || sessionTime is null || !samplesByCar.TryGetValue(referenceCarIdx, out var samples))
            return null;

        for (var index = samples.Count - 1; index >= 0; index--)
        {
            var before = samples[index];
            if (before.Distance > targetDistance.Value) continue;

            double crossingTime;
            if (Math.Abs(before.Distance - targetDistance.Value) < 0.000_001)
            {
                crossingTime = before.SessionTime;
            }
            else
            {
                if (index + 1 >= samples.Count) return null;
                var after = samples[index + 1];
                if (after.Distance < targetDistance.Value || after.Distance <= before.Distance) return null;
                var progress = (targetDistance.Value - before.Distance) / (after.Distance - before.Distance);
                crossingTime = before.SessionTime + (after.SessionTime - before.SessionTime) * progress;
            }

            var gap = sessionTime.Value - crossingTime;
            return gap is >= 0 and <= MaximumGapSeconds && double.IsFinite(gap) ? gap : null;
        }

        return null;
    }

    private static double? RaceDistance(DriverState driver) =>
        driver.CurrentLap > 0 && driver.LapDistPct is >= 0 and < 1.5
            ? driver.CurrentLap - 1 + driver.LapDistPct.Value
            : null;

    private sealed record TrackSample(double Distance, double SessionTime);
}
