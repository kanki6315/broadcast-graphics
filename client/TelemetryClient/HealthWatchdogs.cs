using System.Diagnostics;

namespace RaceControl.TelemetryClient;

internal sealed class TelemetryAcknowledgementTracker
{
    private readonly object gate = new();
    private readonly SortedDictionary<long, long> pending = [];
    private long lastSentSequence;
    private long lastAcknowledgedSequence;
    private long lastAcknowledgedTick;

    public long LastAcknowledgedSequence { get { lock (gate) return lastAcknowledgedSequence; } }

    public void RegisterSent(long sequence, long sentTick)
    {
        lock (gate)
        {
            if (sequence <= lastSentSequence) throw new InvalidOperationException("Telemetry sequences must increase.");
            lastSentSequence = sequence;
            pending.Add(sequence, sentTick);
        }
    }

    public bool CanAcknowledge(long sequence)
    {
        lock (gate) return sequence > 0 && sequence <= lastSentSequence;
    }

    public bool Acknowledge(long sequence, long acknowledgedTick)
    {
        lock (gate)
        {
            if (sequence <= lastAcknowledgedSequence) return false;
            if (sequence > lastSentSequence) throw new InvalidOperationException("The server acknowledged telemetry that was not sent.");
            lastAcknowledgedSequence = sequence;
            lastAcknowledgedTick = acknowledgedTick;
            foreach (var acknowledgedSequence in pending.Keys.TakeWhile(candidate => candidate <= sequence).ToArray())
                pending.Remove(acknowledgedSequence);
            return true;
        }
    }

    public bool HasTimedOut(long nowTick, TimeSpan timeout)
    {
        lock (gate)
            return pending.Count > 0 && Stopwatch.GetElapsedTime(pending.First().Value, nowTick) >= timeout;
    }

    public bool IsAcknowledgementStale(long nowTick, TimeSpan timeout)
    {
        lock (gate)
            return lastAcknowledgedTick != 0 && Stopwatch.GetElapsedTime(lastAcknowledgedTick, nowTick) >= timeout;
    }
}

internal sealed class SourceActivityWatchdog
{
    private readonly object gate = new();
    private bool connected;
    private bool hasObservedFrame;
    private long connectedTick;
    private long lastFrameTick;

    public bool HasObservedFrame { get { lock (gate) return hasObservedFrame; } }

    public void SetConnected(bool value, long nowTick)
    {
        lock (gate)
        {
            connected = value;
            if (value)
            {
                connectedTick = nowTick;
                lastFrameTick = 0;
            }
            else
            {
                connectedTick = 0;
                lastFrameTick = 0;
            }
        }
    }

    public void ObserveFrame(long nowTick)
    {
        lock (gate)
        {
            hasObservedFrame = true;
            lastFrameTick = nowTick;
        }
    }

    public bool IsStalled(long nowTick, TimeSpan initialGrace, TimeSpan frameTimeout)
    {
        lock (gate)
        {
            if (!connected || connectedTick == 0) return false;
            var activityTick = lastFrameTick == 0 ? connectedTick : lastFrameTick;
            var timeout = lastFrameTick == 0 ? initialGrace : frameTimeout;
            return Stopwatch.GetElapsedTime(activityTick, nowTick) >= timeout;
        }
    }
}
