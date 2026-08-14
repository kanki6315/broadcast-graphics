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
        var classified = drivers.Where(driver => driver.Position > 0).ToArray();
        var trustworthyStart = string.Equals(phase, "racing", StringComparison.Ordinal) &&
            classified.Length > 0 && classified.All(driver => driver.LapsCompleted == 0 && driver.CurrentLap <= 1);

        return drivers.Select(driver =>
        {
            if (!baselines.TryGetValue(driver.CarIdx, out var baseline))
            {
                baseline = trustworthyStart && driver.Position > 0
                    ? new PositionBaseline(driver.Position, driver.ClassPosition > 0 ? driver.ClassPosition : null)
                    : new PositionBaseline(null, null);
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
