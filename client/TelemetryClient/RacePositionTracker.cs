namespace RaceControl.TelemetryClient;

internal sealed class RacePositionTracker
{
    private readonly Dictionary<int, PositionBaseline> baselines = [];
    private string? sessionId;

    public DriverState[] Apply(
        string currentSessionId,
        string sessionType,
        string phase,
        IReadOnlyList<DriverState> drivers)
    {
        if (!string.Equals(sessionId, currentSessionId, StringComparison.Ordinal))
        {
            baselines.Clear();
            sessionId = currentSessionId;
        }

        if (!string.Equals(sessionType, "race", StringComparison.Ordinal)) return drivers.ToArray();
        var isPreRace = phase is "get-in-car" or "warmup" or "parade-laps";

        return drivers.Select(driver =>
        {
            if (isPreRace && driver.Position > 0)
            {
                var gridPosition = new PositionBaseline(
                    driver.Position,
                    driver.ClassPosition > 0 ? driver.ClassPosition : null);
                baselines[driver.CarIdx] = gridPosition;
            }

            if (!baselines.TryGetValue(driver.CarIdx, out var baseline))
            {
                baseline = new PositionBaseline(null, null);
                baselines[driver.CarIdx] = baseline;
            }

            return driver with
            {
                StartingPosition = baseline.Overall,
                StartingClassPosition = baseline.Class,
                PositionChange = baseline.Overall is { } overall && driver.Position > 0 ? overall - driver.Position : null,
                ClassPositionChange = baseline.Class is { } classPosition && driver.ClassPosition > 0
                    ? classPosition - driver.ClassPosition
                    : null
            };
        }).ToArray();
    }

    private sealed record PositionBaseline(int? Overall, int? Class);
}
