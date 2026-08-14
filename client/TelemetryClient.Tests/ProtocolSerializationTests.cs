using System.Text.Json;
using Xunit;

namespace RaceControl.TelemetryClient;

public sealed class ProtocolSerializationTests
{
    [Fact]
    public void OptionalIncrementOneFieldsUseTheFrozenWireNamesAndShapes()
    {
        var driver = new DriverState(7, 2, "23", "Driver", "Team", "GT3", 1.2, 82, 81, 4, true, 0)
        {
            PitState = "pit-stall",
            LatestPitVisit = new PitVisitTiming(100, null, 4, 10, 0, 6, 4, true, "41", null, "incomplete"),
            StartingPosition = 4,
            StartingClassPosition = 3,
            PositionChange = 2,
            ClassPositionChange = 1,
            TimingQuality = new Dictionary<string, TimingQualityMetadata>
            {
                ["lastLap"] = new("iracing", "valid")
            }
        };

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(driver, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        var root = document.RootElement;

        Assert.Equal("pit-stall", root.GetProperty("pitState").GetString());
        Assert.Equal(4, root.GetProperty("startingPosition").GetInt32());
        Assert.Equal(2, root.GetProperty("positionChange").GetInt32());
        Assert.Equal(4, root.GetProperty("latestPitVisit").GetProperty("inferredBoxTime").GetDouble());
        Assert.Equal("valid", root.GetProperty("timingQuality").GetProperty("lastLap").GetProperty("quality").GetString());
    }
}
