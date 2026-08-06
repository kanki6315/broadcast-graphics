using System.IO.Compression;
using System.Text.Json;
using System.Threading.Channels;

namespace RaceControl.TelemetryClient;

public sealed record DiagnosticCaptureOptions(string DestinationPath, double SampleRateHz, TimeSpan? Duration);
public sealed record DiagnosticCaptureResult(string DestinationPath, DateTimeOffset StartedAt, DateTimeOffset FinishedAt, string Reason, Exception? Error = null);

public sealed class DiagnosticCapture : IAsyncDisposable
{
    private sealed record DiagnosticRecord(string FileName, string Line);

    private sealed class CaptureSession(
        Guid id,
        string destinationPath,
        string temporaryDirectory,
        DateTimeOffset startedAt,
        TimeSpan sampleInterval,
        Channel<DiagnosticRecord> records)
    {
        public Guid Id { get; } = id;
        public string DestinationPath { get; } = destinationPath;
        public string TemporaryDirectory { get; } = temporaryDirectory;
        public DateTimeOffset StartedAt { get; } = startedAt;
        public TimeSpan SampleInterval { get; } = sampleInterval;
        public Channel<DiagnosticRecord> Records { get; } = records;
        public Dictionary<string, DateTimeOffset> LastSamples { get; } = [];
        public HashSet<string> OnceKeys { get; } = [];
        public required Task WriterTask { get; init; }
        public CancellationTokenSource DurationCancellation { get; } = new();
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly object gate = new();
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private CaptureSession? current;

    public event Action<DiagnosticCaptureResult>? Completed;
    public bool IsCapturing { get { lock (gate) return current is not null; } }
    public Guid? CaptureId { get { lock (gate) return current?.Id; } }

    public async Task StartAsync(DiagnosticCaptureOptions options)
    {
        if (options.SampleRateHz is < 0.1 or > 30) throw new ArgumentOutOfRangeException(nameof(options), "Sample rate must be between 0.1 and 30 Hz.");
        await lifecycle.WaitAsync();
        try
        {
            if (IsCapturing) throw new InvalidOperationException("A diagnostic capture is already running.");
            var startedAt = DateTimeOffset.UtcNow;
            var temporaryDirectory = Path.Combine(Path.GetTempPath(), "Broadcast Graphics", $"capture-{Guid.NewGuid():N}");
            Directory.CreateDirectory(temporaryDirectory);
            Directory.CreateDirectory(Path.GetDirectoryName(options.DestinationPath)!);
            var channel = Channel.CreateBounded<DiagnosticRecord>(new BoundedChannelOptions(2_048)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest
            });
            var session = new CaptureSession(
                Guid.NewGuid(),
                options.DestinationPath,
                temporaryDirectory,
                startedAt,
                TimeSpan.FromSeconds(1d / options.SampleRateHz),
                channel)
            {
                WriterTask = WriteRecordsAsync(temporaryDirectory, channel.Reader)
            };
            lock (gate) current = session;

            await File.WriteAllTextAsync(Path.Combine(temporaryDirectory, "manifest.json"), JsonSerializer.Serialize(new
            {
                formatVersion = 1,
                captureId = session.Id,
                startedAt,
                sampleRateHz = options.SampleRateHz,
                requestedDurationSeconds = options.Duration?.TotalSeconds,
                appVersion = typeof(DiagnosticCapture).Assembly.GetName().Version?.ToString(),
                machine = Environment.MachineName,
                os = Environment.OSVersion.VersionString
            }, new JsonSerializerOptions(JsonOptions) { WriteIndented = true }));
            TryRecord("events.ndjson", new { type = "capture.started", requestedDurationSeconds = options.Duration?.TotalSeconds });

            if (options.Duration is { } duration)
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await Task.Delay(duration, session.DurationCancellation.Token);
                        await StopAsync("duration elapsed");
                    }
                    catch (OperationCanceledException) when (session.DurationCancellation.IsCancellationRequested) { }
                });
            }
        }
        finally
        {
            lifecycle.Release();
        }
    }

    public void TryRecord(string fileName, object payload) => TryQueue(fileName, payload, null, null);
    public void TryRecordSampled(string sampleKey, string fileName, object payload) => TryQueue(fileName, payload, sampleKey, null);
    public void TryRecordOnce(string onceKey, string fileName, object payload) => TryQueue(fileName, payload, null, onceKey);

    private void TryQueue(string fileName, object payload, string? sampleKey, string? onceKey)
    {
        CaptureSession? session;
        var capturedAt = DateTimeOffset.UtcNow;
        lock (gate)
        {
            session = current;
            if (session is null) return;
            if (onceKey is not null && !session.OnceKeys.Add(onceKey)) return;
            if (sampleKey is not null)
            {
                if (session.LastSamples.TryGetValue(sampleKey, out var last) && capturedAt - last < session.SampleInterval) return;
                session.LastSamples[sampleKey] = capturedAt;
            }
        }

        try
        {
            var line = JsonSerializer.Serialize(new { capturedAt, payload }, JsonOptions);
            session.Records.Writer.TryWrite(new DiagnosticRecord(fileName, line));
        }
        catch (Exception error)
        {
            var line = JsonSerializer.Serialize(new { capturedAt, type = "capture.serialization-error", message = error.Message }, JsonOptions);
            session.Records.Writer.TryWrite(new DiagnosticRecord("events.ndjson", line));
        }
    }

    public async Task<DiagnosticCaptureResult?> StopAsync(string reason = "stopped manually")
    {
        await lifecycle.WaitAsync();
        CaptureSession? session;
        try
        {
            lock (gate)
            {
                session = current;
                if (session is null) return null;
                current = null;
            }
            session.DurationCancellation.Cancel();
            session.Records.Writer.TryWrite(new DiagnosticRecord("events.ndjson", JsonSerializer.Serialize(new
            {
                capturedAt = DateTimeOffset.UtcNow,
                payload = new { type = "capture.stopped", reason }
            }, JsonOptions)));
            session.Records.Writer.TryComplete();

            Exception? failure = null;
            try
            {
                await session.WriterTask;
                if (File.Exists(session.DestinationPath)) File.Delete(session.DestinationPath);
                ZipFile.CreateFromDirectory(session.TemporaryDirectory, session.DestinationPath, CompressionLevel.Optimal, false);
            }
            catch (Exception error)
            {
                failure = error;
            }
            finally
            {
                try { Directory.Delete(session.TemporaryDirectory, true); } catch { }
                session.DurationCancellation.Dispose();
            }

            var result = new DiagnosticCaptureResult(session.DestinationPath, session.StartedAt, DateTimeOffset.UtcNow, reason, failure);
            Completed?.Invoke(result);
            return result;
        }
        finally
        {
            lifecycle.Release();
        }
    }

    private static async Task WriteRecordsAsync(string directory, ChannelReader<DiagnosticRecord> reader)
    {
        var writers = new Dictionary<string, StreamWriter>(StringComparer.OrdinalIgnoreCase);
        try
        {
            await foreach (var record in reader.ReadAllAsync())
            {
                if (!writers.TryGetValue(record.FileName, out var writer))
                {
                    writer = new StreamWriter(new FileStream(
                        Path.Combine(directory, record.FileName),
                        FileMode.Append,
                        FileAccess.Write,
                        FileShare.Read,
                        16_384,
                        FileOptions.Asynchronous));
                    writers.Add(record.FileName, writer);
                }
                await writer.WriteLineAsync(record.Line);
            }
        }
        finally
        {
            foreach (var writer in writers.Values) await writer.DisposeAsync();
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync("application closed");
        lifecycle.Dispose();
    }
}
