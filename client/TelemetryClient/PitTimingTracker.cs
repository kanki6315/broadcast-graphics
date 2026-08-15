using System.Globalization;

namespace RaceControl.TelemetryClient;

internal sealed record PitTimingGap(
    string SessionId,
    int CarIdx,
    double StartTime,
    double? EndTime,
    double Duration,
    string? StateBefore,
    string? StateAfter,
    bool DriverChange,
    string Classification,
    string Reason);

internal sealed class PitTimingTracker(Action<PitTimingGap>? onGapRecord = null)
{
    private const int MaximumRetainedGapsPerCar = 64;
    private readonly Dictionary<int, CarPitTimingState> cars = [];
    private string? sessionId;
    private double lastSessionTime = double.NegativeInfinity;

    public DriverState[] Apply(
        string currentSessionId,
        double? sessionTime,
        IReadOnlyList<DriverState> drivers,
        bool freeze = false)
    {
        if (!string.Equals(sessionId, currentSessionId, StringComparison.Ordinal) ||
            sessionTime is { } time && time + 1 < lastSessionTime)
        {
            cars.Clear();
            sessionId = currentSessionId;
        }

        if (sessionTime is not { } observedAt || !double.IsFinite(observedAt)) return drivers.ToArray();
        if (!freeze) lastSessionTime = observedAt;

        return drivers.Select(driver =>
        {
            if (!cars.TryGetValue(driver.CarIdx, out var state))
            {
                state = new CarPitTimingState(currentSessionId, driver.CarIdx, onGapRecord);
                cars[driver.CarIdx] = state;
            }

            var pitState = driver.PitState ?? "unobserved";
            var driverId = driver.UserId > 0 ? driver.UserId.ToString(CultureInfo.InvariantCulture) : null;
            if (!freeze) state.Observe(observedAt, pitState, driverId);
            return driver with { LatestPitVisit = state.LatestVisit(freeze ? lastSessionTime : observedAt) };
        }).ToArray();
    }

    public IReadOnlyList<PitTimingGap> GetGaps(int carIdx) =>
        cars.TryGetValue(carIdx, out var state) ? state.Gaps(lastSessionTime) : [];

    private sealed class CarPitTimingState(
        string sessionId,
        int carIdx,
        Action<PitTimingGap>? onGapRecord)
    {
        private readonly List<PitTimingGap> completedGaps = [];
        private string? lastObservedState;
        private double? lastObservedTime;
        private string? lastObservedDriverId;
        private bool isUnobserved;
        private double? gapStartTime;
        private string? gapStartState;
        private string? gapStartDriverId;
        private bool gapDriverChange;
        private MutablePitVisit? activeVisit;
        private PitVisitTiming? completedVisit;

        public void Observe(double observedAt, string pitState, string? driverId)
        {
            if (string.Equals(pitState, "unobserved", StringComparison.Ordinal))
            {
                BeginOrContinueGap(observedAt, driverId);
                return;
            }

            if (isUnobserved)
                ResolveGap(observedAt, pitState, driverId);
            else
                ObserveContinuousState(observedAt, pitState, driverId);

            lastObservedState = pitState;
            lastObservedTime = observedAt;
            lastObservedDriverId = driverId;
        }

        public PitVisitTiming? LatestVisit(double observedAt)
        {
            if (activeVisit is null) return completedVisit;
            var unresolved = isUnobserved && gapStartTime is { } start ? Duration(start, observedAt) : 0;
            return activeVisit.Snapshot(null, unresolved, open: true);
        }

        public IReadOnlyList<PitTimingGap> Gaps(double observedAt)
        {
            if (!isUnobserved) return completedGaps.ToArray();
            return [.. completedGaps, CurrentGap(observedAt)];
        }

        private void BeginOrContinueGap(double observedAt, string? driverId)
        {
            if (!isUnobserved)
            {
                isUnobserved = true;
                gapStartTime = lastObservedTime ?? observedAt;
                gapStartState = lastObservedState;
                gapStartDriverId = lastObservedDriverId;
                gapDriverChange = DifferentDriver(gapStartDriverId, driverId);
            }
            else if (DifferentDriver(gapStartDriverId, driverId))
            {
                gapDriverChange = true;
            }

            if (gapDriverChange && activeVisit is not null) activeVisit.DriverChange = true;
            onGapRecord?.Invoke(CurrentGap(observedAt));
        }

        private void ResolveGap(double observedAt, string pitState, string? driverId)
        {
            var start = gapStartTime ?? observedAt;
            var before = gapStartState;
            var duration = Duration(start, observedAt);
            var beforeWasPit = IsPit(before);
            var afterIsPit = IsPit(pitState);
            var driverChanged = gapDriverChange || DifferentDriver(gapStartDriverId, driverId);
            var inferredBox = string.Equals(before, "pit-stall", StringComparison.Ordinal) &&
                string.Equals(pitState, "pit-stall", StringComparison.Ordinal);

            if (activeVisit is null && (beforeWasPit || afterIsPit))
                activeVisit = new MutablePitVisit(start, gapStartDriverId ?? driverId);

            if (activeVisit is not null)
            {
                if (inferredBox)
                    activeVisit.InferredBoxTime += duration;
                else
                    activeVisit.UnknownTime += duration;

                if (driverChanged) activeVisit.DriverChange = true;
                if (!afterIsPit) CloseVisit(observedAt, driverId);
            }

            var completedGap = new PitTimingGap(
                sessionId,
                carIdx,
                start,
                observedAt,
                duration,
                before,
                pitState,
                driverChanged,
                inferredBox ? "inferred-box-time" : beforeWasPit || afterIsPit ? "unknown-time" : "unknown-timing-gap",
                inferredBox
                    ? "pit-stall observed before and after the missing interval"
                    : beforeWasPit || afterIsPit
                        ? "missing interval was not bracketed by pit-stall observations"
                        : "car was unobserved away from a pit visit");
            completedGaps.Add(completedGap);
            if (completedGaps.Count > MaximumRetainedGapsPerCar) completedGaps.RemoveAt(0);
            onGapRecord?.Invoke(completedGap);

            isUnobserved = false;
            gapStartTime = null;
            gapStartState = null;
            gapStartDriverId = null;
            gapDriverChange = false;
        }

        private PitTimingGap CurrentGap(double observedAt)
        {
            var start = gapStartTime ?? observedAt;
            return new PitTimingGap(
                sessionId,
                carIdx,
                start,
                null,
                Duration(start, observedAt),
                gapStartState,
                null,
                gapDriverChange,
                "unresolved-unknown-time",
                "car is still unobserved");
        }

        private void ObserveContinuousState(double observedAt, string pitState, string? driverId)
        {
            if (lastObservedTime is null || lastObservedState is null)
            {
                if (IsPit(pitState)) activeVisit = new MutablePitVisit(observedAt, driverId);
                return;
            }

            var duration = Duration(lastObservedTime.Value, observedAt);
            if (activeVisit is null && IsPit(lastObservedState))
                activeVisit = new MutablePitVisit(lastObservedTime.Value, lastObservedDriverId);
            if (activeVisit is null && IsPit(pitState))
                activeVisit = new MutablePitVisit(observedAt, driverId);

            if (activeVisit is not null)
            {
                if (string.Equals(lastObservedState, "pit-stall", StringComparison.Ordinal))
                    activeVisit.ObservedBoxTime += duration;
                else if (string.Equals(lastObservedState, "pit-lane", StringComparison.Ordinal))
                    activeVisit.PitLaneTime += duration;

                if (DifferentDriver(lastObservedDriverId, driverId)) activeVisit.DriverChange = true;
                if (!IsPit(pitState)) CloseVisit(observedAt, driverId);
            }
        }

        private void CloseVisit(double pitExitTime, string? exitDriverId)
        {
            if (activeVisit is null) return;
            completedVisit = activeVisit.Snapshot(pitExitTime, 0, open: false, exitDriverId);
            activeVisit = null;
        }

        private static bool IsPit(string? state) => state is "pit-lane" or "pit-stall";

        private static bool DifferentDriver(string? before, string? after) =>
            before is not null && after is not null && !string.Equals(before, after, StringComparison.Ordinal);

        private static double Duration(double start, double end) =>
            double.IsFinite(start) && double.IsFinite(end) ? Math.Max(end - start, 0) : 0;
    }

    private sealed class MutablePitVisit(double pitEntryTime, string? entryDriverId)
    {
        public double PitLaneTime { get; set; }
        public double ObservedBoxTime { get; set; }
        public double InferredBoxTime { get; set; }
        public double UnknownTime { get; set; }
        public bool DriverChange { get; set; }

        public PitVisitTiming Snapshot(
            double? pitExitTime,
            double unresolvedUnknownTime,
            bool open,
            string? exitDriverId = null)
        {
            var unknownTime = UnknownTime + unresolvedUnknownTime;
            var quality = open || unknownTime > 0
                ? "incomplete"
                : InferredBoxTime > 0
                    ? "contains-inference"
                    : "valid";
            return new PitVisitTiming(
                pitEntryTime,
                pitExitTime,
                PitLaneTime,
                ObservedBoxTime + InferredBoxTime,
                unknownTime,
                ObservedBoxTime,
                InferredBoxTime,
                DriverChange,
                entryDriverId,
                exitDriverId,
                quality);
        }
    }
}
