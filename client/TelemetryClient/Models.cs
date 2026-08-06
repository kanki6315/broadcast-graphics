using System.Text.Json.Serialization;

namespace RaceControl.TelemetryClient;

public sealed record DriverState(
    [property: JsonPropertyName("carIdx")] int CarIdx,
    [property: JsonPropertyName("position")] int Position,
    [property: JsonPropertyName("carNumber")] string CarNumber,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("team")] string Team,
    [property: JsonPropertyName("className")] string ClassName,
    [property: JsonPropertyName("interval")] double? Interval,
    [property: JsonPropertyName("lastLap")] double? LastLap,
    [property: JsonPropertyName("bestLap")] double? BestLap,
    [property: JsonPropertyName("lapsCompleted")] int LapsCompleted,
    [property: JsonPropertyName("onPitRoad")] bool OnPitRoad,
    [property: JsonPropertyName("incidents")] int Incidents);

public sealed record SessionState(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("trackName")] string TrackName,
    [property: JsonPropertyName("lap")] int Lap,
    [property: JsonPropertyName("totalLaps")] int? TotalLaps,
    [property: JsonPropertyName("timeRemaining")] double? TimeRemaining,
    [property: JsonPropertyName("flag")] string Flag,
    [property: JsonPropertyName("timestamp")] string Timestamp,
    [property: JsonPropertyName("drivers")] IReadOnlyList<DriverState> Drivers);
