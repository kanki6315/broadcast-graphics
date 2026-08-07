using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Text.Json;
using SVappsLAB.iRacingTelemetrySDK;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace RaceControl.TelemetryClient;

public sealed record DiagnosticReplayInfo(
    int FormatVersion,
    DateTimeOffset CapturedAt,
    TimeSpan Duration,
    int SampleCount,
    IReadOnlyList<string> SessionNames,
    string TrackName,
    int DriverCount,
    int ClassCount,
    string StreamKind);

public sealed record ReplayProgress(
    TimeSpan Position,
    TimeSpan Duration,
    int SampleNumber,
    int SampleCount,
    bool IsPaused,
    bool IsComplete);

public interface IReplayControl
{
    event Action<ReplayProgress>? ProgressChanged;
    void Pause();
    void Resume();
    void Restart();
}

public sealed class DiagnosticReplayArchive
{
    private const long MaximumNormalizedBytes = 250L * 1024 * 1024;
    private const long MaximumSessionInfoBytes = 500L * 1024 * 1024;
    private const long MaximumManifestBytes = 1024L * 1024;
    private const int MaximumSamples = 250_000;
    private const int MaximumLineCharacters = 5_000_000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    internal sealed record Frame(DateTimeOffset CapturedAt, SessionState State);

    private DiagnosticReplayArchive(DiagnosticReplayInfo info, IReadOnlyList<Frame> frames)
    {
        Info = info;
        Frames = frames;
    }

    public DiagnosticReplayInfo Info { get; }
    internal IReadOnlyList<Frame> Frames { get; }

    public static async Task<DiagnosticReplayArchive> LoadAsync(string path, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            throw new InvalidDataException("Choose an existing Gantry diagnostic ZIP.");

        try
        {
            using var archive = ZipFile.OpenRead(path);
            var manifestEntry = FindEntry(archive, "manifest.json")
                ?? throw new InvalidDataException("This ZIP is missing manifest.json and is not a compatible diagnostic capture.");
            if (manifestEntry.Length > MaximumManifestBytes)
                throw new InvalidDataException("The diagnostic manifest is larger than the 1 MB safety limit.");

            var (formatVersion, manifestStartedAt) = await ReadManifestAsync(manifestEntry, cancellationToken);
            if (formatVersion != 1)
                throw new InvalidDataException($"Capture format {formatVersion} is not supported by this client. Expected format 1.");

            var normalizedEntry = FindEntry(archive, "normalized.ndjson");
            List<Frame> frames;
            string streamKind;
            if (normalizedEntry is not null)
            {
                if (normalizedEntry.Length > MaximumNormalizedBytes)
                    throw new InvalidDataException("The normalized replay stream is larger than the 250 MB safety limit.");
                frames = await ReadFramesAsync(normalizedEntry, cancellationToken);
                streamKind = "Normalized output";
            }
            else
            {
                frames = await ReconstructFramesAsync(archive, cancellationToken);
                streamKind = "Reconstructed SDK capture";
            }
            var first = frames[0];
            var last = frames[^1];
            var duration = last.CapturedAt > first.CapturedAt ? last.CapturedAt - first.CapturedAt : TimeSpan.Zero;
            var capturedAt = manifestStartedAt ?? first.CapturedAt;
            var sessionNames = frames
                .Select(frame => frame.State.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var driverCount = frames.Max(frame => frame.State.Drivers.Count);
            var classCount = frames
                .SelectMany(frame => frame.State.Drivers)
                .Select(driver => driver.ClassName)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count();
            var info = new DiagnosticReplayInfo(
                formatVersion,
                capturedAt,
                duration,
                frames.Count,
                sessionNames.Length > 0 ? sessionNames : ["Captured session"],
                first.State.TrackName,
                driverCount,
                classCount,
                streamKind);
            return new DiagnosticReplayArchive(info, frames);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new InvalidDataException($"The diagnostic replay could not be read: {error.Message}", error);
        }
    }

    private static ZipArchiveEntry? FindEntry(ZipArchive archive, string name) =>
        archive.Entries.FirstOrDefault(entry => string.Equals(entry.FullName, name, StringComparison.OrdinalIgnoreCase));

    private static async Task<(int FormatVersion, DateTimeOffset? StartedAt)> ReadManifestAsync(
        ZipArchiveEntry entry,
        CancellationToken cancellationToken)
    {
        await using var stream = entry.Open();
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        if (!root.TryGetProperty("formatVersion", out var versionElement) || !versionElement.TryGetInt32(out var version))
            throw new InvalidDataException("The diagnostic manifest has no valid format version.");
        DateTimeOffset? startedAt = null;
        if (root.TryGetProperty("startedAt", out var startedElement) &&
            startedElement.ValueKind == JsonValueKind.String &&
            startedElement.TryGetDateTimeOffset(out var parsedStartedAt))
            startedAt = parsedStartedAt;
        return (version, startedAt);
    }

    private static async Task<List<Frame>> ReadFramesAsync(
        ZipArchiveEntry entry,
        CancellationToken cancellationToken)
    {
        var frames = new List<Frame>();
        await using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        var lineNumber = 0;
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lineNumber++;
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (line.Length > MaximumLineCharacters)
                throw new InvalidDataException($"Replay sample {lineNumber} exceeds the 5 MB safety limit.");
            if (frames.Count >= MaximumSamples)
                throw new InvalidDataException($"The replay contains more than the {MaximumSamples:N0}-sample safety limit.");

            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (!root.TryGetProperty("capturedAt", out var capturedElement) ||
                    capturedElement.ValueKind != JsonValueKind.String ||
                    !capturedElement.TryGetDateTimeOffset(out var capturedAt))
                    throw new InvalidDataException("Sample timestamp is missing or invalid.");
                if (!root.TryGetProperty("payload", out var payloadElement))
                    throw new InvalidDataException("Sample payload is missing.");
                var state = payloadElement.Deserialize<SessionState>(JsonOptions)
                    ?? throw new InvalidDataException("Sample payload is empty.");
                if (state.Drivers is null)
                    throw new InvalidDataException("Sample driver data is missing.");
                frames.Add(new Frame(capturedAt, state));
            }
            catch (Exception error) when (error is JsonException or InvalidDataException)
            {
                throw new InvalidDataException($"Replay sample {lineNumber} is invalid: {error.Message}", error);
            }
        }

        if (frames.Count == 0)
            throw new InvalidDataException("The normalized replay stream contains no telemetry samples.");
        return frames;
    }

    private sealed record SessionUpdate(DateTimeOffset CapturedAt, TelemetrySessionInfo Session);

    private static async Task<List<Frame>> ReconstructFramesAsync(
        ZipArchive archive,
        CancellationToken cancellationToken)
    {
        var telemetryEntry = FindEntry(archive, "telemetry.ndjson")
            ?? throw new InvalidDataException("This capture has neither normalized output nor SDK telemetry to replay.");
        var sessionEntry = FindEntry(archive, "session-info.ndjson")
            ?? throw new InvalidDataException("This SDK capture is missing session information required for replay.");
        if (telemetryEntry.Length > MaximumNormalizedBytes)
            throw new InvalidDataException("The SDK telemetry stream is larger than the 250 MB safety limit.");
        if (sessionEntry.Length > MaximumSessionInfoBytes)
            throw new InvalidDataException("The session information stream is larger than the 500 MB safety limit.");

        var sessionUpdates = await ReadSessionUpdatesAsync(sessionEntry, cancellationToken);
        var frames = new List<Frame>();
        await using var stream = telemetryEntry.Open();
        using var reader = new StreamReader(stream);
        var sessionIndex = 0;
        var lineNumber = 0;
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lineNumber++;
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (line.Length > MaximumLineCharacters)
                throw new InvalidDataException($"SDK telemetry sample {lineNumber} exceeds the 5 MB safety limit.");
            if (frames.Count >= MaximumSamples)
                throw new InvalidDataException($"The replay contains more than the {MaximumSamples:N0}-sample safety limit.");

            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                var capturedAt = ReadCapturedAt(root, "SDK telemetry", lineNumber);
                while (sessionIndex + 1 < sessionUpdates.Count && sessionUpdates[sessionIndex + 1].CapturedAt <= capturedAt)
                    sessionIndex++;
                var telemetry = root.GetProperty("payload").Deserialize<TelemetryData>(JsonOptions);
                var state = TelemetrySnapshotMapper.Map(telemetry, sessionUpdates[sessionIndex].Session, capturedAt);
                frames.Add(new Frame(capturedAt, state));
            }
            catch (Exception error) when (error is JsonException or InvalidDataException or KeyNotFoundException)
            {
                throw new InvalidDataException($"SDK telemetry sample {lineNumber} is invalid: {error.Message}", error);
            }
        }

        if (frames.Count == 0)
            throw new InvalidDataException("The SDK telemetry stream contains no replayable samples.");
        return frames;
    }

    private static async Task<List<SessionUpdate>> ReadSessionUpdatesAsync(
        ZipArchiveEntry entry,
        CancellationToken cancellationToken)
    {
        var updates = new List<SessionUpdate>();
        var deserializer = new DeserializerBuilder()
            .WithNamingConvention(NullNamingConvention.Instance)
            .IgnoreUnmatchedProperties()
            .Build();
        await using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        var lineNumber = 0;
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lineNumber++;
            if (string.IsNullOrWhiteSpace(line)) continue;
            if (line.Length > MaximumLineCharacters)
                throw new InvalidDataException($"Session update {lineNumber} exceeds the 5 MB safety limit.");
            try
            {
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                var capturedAt = ReadCapturedAt(root, "session update", lineNumber);
                var yaml = root.GetProperty("payload").GetProperty("yaml").GetString();
                if (string.IsNullOrWhiteSpace(yaml)) throw new InvalidDataException("Session YAML is empty.");
                var session = deserializer.Deserialize<TelemetrySessionInfo>(yaml)
                    ?? throw new InvalidDataException("Session YAML could not be decoded.");
                updates.Add(new SessionUpdate(capturedAt, session));
            }
            catch (Exception error) when (error is JsonException or InvalidDataException or YamlDotNet.Core.YamlException or KeyNotFoundException)
            {
                throw new InvalidDataException($"Session update {lineNumber} is invalid: {error.Message}", error);
            }
        }

        if (updates.Count == 0)
            throw new InvalidDataException("The session information stream contains no replayable updates.");
        return updates;
    }

    private static DateTimeOffset ReadCapturedAt(JsonElement root, string label, int lineNumber)
    {
        if (!root.TryGetProperty("capturedAt", out var capturedElement) ||
            capturedElement.ValueKind != JsonValueKind.String ||
            !capturedElement.TryGetDateTimeOffset(out var capturedAt))
            throw new InvalidDataException($"{label} {lineNumber} has no valid timestamp.");
        if (!root.TryGetProperty("payload", out _))
            throw new InvalidDataException($"{label} {lineNumber} has no payload.");
        return capturedAt;
    }
}

public sealed class DiagnosticReplayTelemetrySource(
    string archivePath,
    double playbackSpeed,
    DiagnosticCapture diagnostics) : ITelemetrySource, IReplayControl
{
    private readonly object gate = new();
    private TaskCompletionSource stateChanged = CreateSignal();
    private bool paused;
    private bool restartRequested;
    private ReplayProgress progress = new(TimeSpan.Zero, TimeSpan.Zero, 0, 0, false, false);

    public event Action<bool, string>? ConnectionChanged;
    public event Action? FrameObserved;
    public event Action<string>? Log;
    public event Action<ReplayProgress>? ProgressChanged;

    public async IAsyncEnumerable<SessionState> ReadAsync([EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var archive = await DiagnosticReplayArchive.LoadAsync(archivePath, cancellationToken);
        var frames = archive.Frames;
        var firstTimestamp = frames[0].CapturedAt;
        var speedLabel = playbackSpeed <= 0 ? "maximum speed" : $"{playbackSpeed:0.##}×";
        ConnectionChanged?.Invoke(true, $"Diagnostic replay — {Path.GetFileName(archivePath)}");
        Log?.Invoke($"Diagnostic replay loaded: {string.Join(" → ", archive.Info.SessionNames)}, {archive.Info.SampleCount:N0} samples at {speedLabel}.");
        diagnostics.TryRecord("events.ndjson", new { type = "replay.started", archive = Path.GetFileName(archivePath), playbackSpeed });

        var index = 0;
        PublishProgress(TimeSpan.Zero, archive.Info.Duration, index, frames.Count, false);
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await WaitUntilPlayingAsync(cancellationToken);
                if (ConsumeRestart())
                {
                    index = 0;
                    ConnectionChanged?.Invoke(true, $"Diagnostic replay — {Path.GetFileName(archivePath)}");
                    Log?.Invoke("Diagnostic replay restarted.");
                    PublishProgress(TimeSpan.Zero, archive.Info.Duration, index, frames.Count, false);
                }

                if (index >= frames.Count)
                {
                    if (!CurrentProgress().IsComplete)
                    {
                        PublishProgress(archive.Info.Duration, archive.Info.Duration, frames.Count, frames.Count, true);
                        ConnectionChanged?.Invoke(true, "Diagnostic replay complete");
                    }
                    await WaitForStateChangeAsync(Timeout.InfiniteTimeSpan, cancellationToken);
                    continue;
                }

                var frame = frames[index];
                FrameObserved?.Invoke();
                yield return frame.State with { SourceMode = "replay" };
                index++;
                var position = frame.CapturedAt > firstTimestamp ? frame.CapturedAt - firstTimestamp : TimeSpan.Zero;
                PublishProgress(position, archive.Info.Duration, index, frames.Count, index >= frames.Count);
                if (index >= frames.Count)
                    ConnectionChanged?.Invoke(true, "Diagnostic replay complete");

                if (index < frames.Count && playbackSpeed > 0)
                {
                    var capturedDelay = frames[index].CapturedAt - frame.CapturedAt;
                    if (capturedDelay > TimeSpan.Zero)
                    {
                        var scaledDelay = TimeSpan.FromTicks((long)(capturedDelay.Ticks / playbackSpeed));
                        await WaitForStateChangeAsync(scaledDelay, cancellationToken);
                    }
                }
            }
        }
        finally
        {
            ConnectionChanged?.Invoke(false, "Diagnostic replay stopped");
        }
    }

    public void Pause()
    {
        lock (gate)
        {
            if (progress.IsComplete || paused) return;
            paused = true;
            SignalStateChangedLocked();
            PublishProgressLocked(progress with { IsPaused = true });
        }
        Log?.Invoke("Diagnostic replay paused.");
    }

    public void Resume()
    {
        lock (gate)
        {
            if (!paused) return;
            paused = false;
            SignalStateChangedLocked();
            PublishProgressLocked(progress with { IsPaused = false });
        }
        Log?.Invoke("Diagnostic replay resumed.");
    }

    public void Restart()
    {
        lock (gate)
        {
            restartRequested = true;
            paused = false;
            SignalStateChangedLocked();
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private async Task WaitUntilPlayingAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            Task signal;
            lock (gate)
            {
                if (!paused || restartRequested) return;
                signal = stateChanged.Task;
            }
            await signal.WaitAsync(cancellationToken);
        }
    }

    private bool ConsumeRestart()
    {
        lock (gate)
        {
            if (!restartRequested) return false;
            restartRequested = false;
            return true;
        }
    }

    private async Task WaitForStateChangeAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        Task signal;
        lock (gate)
        {
            if (paused || restartRequested) return;
            signal = stateChanged.Task;
        }
        if (delay == Timeout.InfiniteTimeSpan)
        {
            await signal.WaitAsync(cancellationToken);
            return;
        }

        var delayTask = Task.Delay(delay, cancellationToken);
        var completed = await Task.WhenAny(delayTask, signal);
        if (completed == delayTask) await delayTask;
    }

    private ReplayProgress CurrentProgress()
    {
        lock (gate) return progress;
    }

    private void PublishProgress(TimeSpan position, TimeSpan duration, int sampleNumber, int sampleCount, bool complete)
    {
        ReplayProgress next;
        lock (gate)
        {
            next = new ReplayProgress(position, duration, sampleNumber, sampleCount, paused, complete);
            progress = next;
        }
        ProgressChanged?.Invoke(next);
    }

    private void PublishProgressLocked(ReplayProgress next)
    {
        progress = next;
        ProgressChanged?.Invoke(next);
    }

    private void SignalStateChangedLocked()
    {
        var previous = stateChanged;
        stateChanged = CreateSignal();
        previous.TrySetResult();
    }

    private static TaskCompletionSource CreateSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);
}
