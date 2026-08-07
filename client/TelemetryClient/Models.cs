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
    [property: JsonPropertyName("incidents")] int Incidents,
    [property: JsonPropertyName("classId")] int ClassId = 0,
    [property: JsonPropertyName("classColor")] string ClassColor = "#ffffff",
    [property: JsonPropertyName("classPosition")] int ClassPosition = 0,
    [property: JsonPropertyName("gapToLeader")] double? GapToLeader = null,
    [property: JsonPropertyName("intervalToAhead")] double? IntervalToAhead = null,
    [property: JsonPropertyName("classGapToLeader")] double? ClassGapToLeader = null,
    [property: JsonPropertyName("classIntervalToAhead")] double? ClassIntervalToAhead = null,
    [property: JsonPropertyName("lapsBehindLeader")] int LapsBehindLeader = 0,
    [property: JsonPropertyName("lapsBehindClassLeader")] int LapsBehindClassLeader = 0,
    [property: JsonPropertyName("currentLap")] int CurrentLap = 0,
    [property: JsonPropertyName("lastLapNumber")] int? LastLapNumber = null,
    [property: JsonPropertyName("bestLapNumber")] int? BestLapNumber = null,
    [property: JsonPropertyName("lapDistPct")] double? LapDistPct = null,
    [property: JsonPropertyName("trackStatus")] string TrackStatus = "unknown",
    [property: JsonPropertyName("isConnected")] bool IsConnected = false);

public sealed record CarClassState(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("color")] string Color,
    [property: JsonPropertyName("carCount")] int CarCount);

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
    [property: JsonPropertyName("drivers")] IReadOnlyList<DriverState> Drivers,
    [property: JsonPropertyName("lapsCompleted")] int LapsCompleted = 0,
    [property: JsonPropertyName("lapsRemaining")] int? LapsRemaining = null,
    [property: JsonPropertyName("timeElapsed")] double? TimeElapsed = null,
    [property: JsonPropertyName("totalTime")] double? TotalTime = null,
    [property: JsonPropertyName("phase")] string Phase = "invalid",
    [property: JsonPropertyName("startState")] string StartState = "hidden",
    [property: JsonPropertyName("flags")] IReadOnlyList<string>? Flags = null,
    [property: JsonPropertyName("classes")] IReadOnlyList<CarClassState>? Classes = null);
