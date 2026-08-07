using System.Diagnostics;
using Xunit;

namespace RaceControl.TelemetryClient.Tests;

public sealed class HealthWatchdogTests
{
    [Fact]
    public void AcknowledgementIsCumulativeAndCannotMoveBackward()
    {
        var tracker = new TelemetryAcknowledgementTracker();
        tracker.RegisterSent(1, Tick(1));
        tracker.RegisterSent(2, Tick(2));

        Assert.True(tracker.Acknowledge(2, Tick(2.5)));
        Assert.Equal(2, tracker.LastAcknowledgedSequence);
        Assert.False(tracker.Acknowledge(1, Tick(3)));
        Assert.False(tracker.HasTimedOut(Tick(10), TimeSpan.FromSeconds(3)));
    }

    [Fact]
    public void OldestOutstandingSequenceControlsTransportTimeout()
    {
        var tracker = new TelemetryAcknowledgementTracker();
        tracker.RegisterSent(1, Tick(1));
        tracker.RegisterSent(2, Tick(2));

        Assert.False(tracker.HasTimedOut(Tick(3.9), TimeSpan.FromSeconds(3)));
        Assert.True(tracker.HasTimedOut(Tick(4), TimeSpan.FromSeconds(3)));
    }

    [Fact]
    public void AcknowledgementHealthExpiresIndependentlyOfOutstandingFrames()
    {
        var tracker = new TelemetryAcknowledgementTracker();
        tracker.RegisterSent(1, Tick(1));
        tracker.Acknowledge(1, Tick(2));

        Assert.False(tracker.IsAcknowledgementStale(Tick(4.9), TimeSpan.FromSeconds(3)));
        Assert.True(tracker.IsAcknowledgementStale(Tick(5), TimeSpan.FromSeconds(3)));
        Assert.False(tracker.CanAcknowledge(2));
    }

    [Fact]
    public void SourceUsesInitialGraceThenFrameDeadline()
    {
        var watchdog = new SourceActivityWatchdog();
        watchdog.SetConnected(true, Tick(1));

        Assert.False(watchdog.IsStalled(Tick(10.9), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(3)));
        Assert.True(watchdog.IsStalled(Tick(11), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(3)));

        watchdog.ObserveFrame(Tick(12));
        Assert.False(watchdog.IsStalled(Tick(14.9), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(3)));
        Assert.True(watchdog.IsStalled(Tick(15), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(3)));
    }

    [Fact]
    public void DisconnectedSourceDoesNotTripWatchdog()
    {
        var watchdog = new SourceActivityWatchdog();
        watchdog.SetConnected(true, Tick(1));
        watchdog.SetConnected(false, Tick(2));

        Assert.False(watchdog.IsStalled(Tick(100), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(3)));
    }

    private static long Tick(double seconds) => (long)(seconds * Stopwatch.Frequency);
}
