using System.IO.Compression;
using System.Text.Json;
using Xunit;

namespace RaceControl.TelemetryClient;

public sealed class DiagnosticReplayTests
{
    [Fact]
    public async Task FormatOneNormalizedCaptureWithoutIncrementOneFieldsStillReplays()
    {
        var path = Path.Combine(Path.GetTempPath(), $"gantry-legacy-{Guid.NewGuid():N}.zip");
        try
        {
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Create))
            {
                await WriteAsync(archive, "manifest.json", JsonSerializer.Serialize(new
                {
                    formatVersion = 1,
                    startedAt = "2025-01-01T12:00:00Z"
                }));
                var payload = new
                {
                    id = "legacy-race", name = "Legacy Race", type = "race", trackName = "Legacy Circuit",
                    lap = 8, totalLaps = 20, timeRemaining = (double?)null, flag = "green",
                    timestamp = "2025-01-01T12:00:00Z",
                    drivers = new[]
                    {
                        new
                        {
                            carIdx = 7, position = 2, carNumber = "23", name = "Legacy Driver", team = "Legacy Team",
                            className = "GT3", interval = (double?)1.2, lastLap = (double?)82.1, bestLap = (double?)81.9,
                            lapsCompleted = 7, onPitRoad = false, incidents = 0
                        }
                    }
                };
                var sample = JsonSerializer.Serialize(new { capturedAt = "2025-01-01T12:00:00Z", payload });
                await WriteAsync(archive, "normalized.ndjson", sample + Environment.NewLine);
            }

            var replay = await DiagnosticReplayArchive.LoadAsync(path);
            var driver = Assert.Single(Assert.Single(replay.Frames).State.Drivers);

            Assert.Equal(1, replay.Info.FormatVersion);
            Assert.Equal("Normalized output", replay.Info.StreamKind);
            Assert.Equal("Legacy Circuit", replay.Info.TrackName);
            Assert.Null(driver.PitState);
            Assert.Null(driver.LatestPitVisit);
            Assert.Null(driver.StartingPosition);
            Assert.Null(driver.TimingQuality);
            Assert.Null(driver.Sectors);
            Assert.Null(Assert.Single(replay.Frames).State.SectorDefinition);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    private static async Task WriteAsync(ZipArchive archive, string name, string content)
    {
        var entry = archive.CreateEntry(name);
        await using var stream = entry.Open();
        await using var writer = new StreamWriter(stream);
        await writer.WriteAsync(content);
    }
}
