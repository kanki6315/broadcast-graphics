# Telemetry contract

The Windows client owns iRacing-specific interpretation. The server and graphic packages receive normalized broadcast facts and must not reinterpret SDK variables.

This contract was checked against two real diagnostic captures:

- a single-class IndyCar race at Phoenix covering laps 57–71, two cautions, a one-lap-to-green period, and a restart;
- a 41-car, two-class Long Beach session covering practice, qualifying, the race start, and five race laps.

The mapper behavior is also covered by `client/TelemetryClient.Tests` so SDK changes cannot silently change these meanings.

## Session timing

| Field | Meaning |
| --- | --- |
| `lap` | Current race lap: leader completed laps plus one, capped at the scheduled total. It is zero before a live race leader exists and during parade laps. Never use the spectator `Lap` SDK variable. |
| `lapsCompleted` | Laps completed by the overall leader. |
| `totalLaps` / `lapsRemaining` | Scheduled and remaining laps when iRacing supplies a finite value. |
| `timeElapsed` / `timeRemaining` / `totalTime` | Session-clock values in seconds. |
| `phase` | `get-in-car`, `warmup`, `parade-laps`, `racing`, `checkered`, `cool-down`, or `invalid`. |
| `startState` | Start-light state: `hidden`, `ready`, `set`, or `go`. |
| `flag` | Simplified primary state for ordinary graphics: `green`, `yellow`, `white`, `red`, or `checkered`. |
| `flags` | All active, meaningful SDK flags. This preserves details such as `caution-waving`, `one-lap-to-green`, and `green-held`. |

## Driver classification and timing

| Field | Meaning |
| --- | --- |
| `position` / `classPosition` | One-based overall and class running positions. Session-result class positions are converted from iRacing's zero-based values. |
| `gapToLeader` | Race-only time gap in seconds to the overall leader when the cars are on the same completed lap. |
| `intervalToAhead` | Race-only time gap in seconds to the preceding overall-position car, derived from leader gaps. |
| `classGapToLeader` | Race-only time gap to the driver's class leader. |
| `classIntervalToAhead` | Race-only time gap to the preceding class-position car. |
| `lapsBehindLeader` / `lapsBehindClassLeader` | Completed-lap deficit. When nonzero, the corresponding seconds gap is `null` instead of showing a misleading time. |
| `interval` | Compatibility alias for `gapToLeader`. New graphics should not use it. |

`CarIdxF2Time` is interpreted as an overall-leader gap only during a race. In practice and qualifying it represents a lap-time value, so the normalized gap fields are deliberately `null`.

## Lap-time graphics

The normalized driver state contains:

- `lastLap` and `lastLapNumber`: the most recently completed lap time and the lap it belongs to;
- `bestLap` and `bestLapNumber`: the driver's session-best lap and its lap number;
- `currentLap` and `lapDistPct`: the lap being driven and approximate progress around it.

These fields support trustworthy last-lap, personal-best, class-best, session-best, and comparison graphics. A graphic should only announce a new lap when `lastLapNumber` advances; repeated telemetry frames are not new laps.

There is no reliable per-car live current-lap stopwatch in the available spectator data. Do not synthesize one from `lapDistPct`. If a live estimate is added later, it must be labeled as an estimate.

The client also pairs a completed race lap with `ResultsPositions.Time` only when the result's completed-lap number matches `lastLapNumber`. This produces `lastLapGapToLeader`, a scoring-line gap rather than a sampled in-lap estimate. Overall and class lap deficits remain separate from seconds gaps.

The server converts matching lap results into durable completed-lap records. It deduplicates them by session, entry, and lap number, and emits `lap.completed` only after the database insert succeeds. The resulting history supports lap-time and scoring-gap trends, deltas to personal/class/session best, consistency, stint analysis, and automatic fastest-lap cues.

Sector times are intentionally outside this contract. iRacing exposes sector boundary locations but not completed sector results for every car, and this product does not synthesize sector timing from car position.

## Track and connection state

`trackStatus` is one of `running`, `pit`, `off-track`, `not-in-world`, `retired`, or `unknown`. `isConnected` indicates whether the car is represented in the current world; it does not mean that the driver's telemetry client is connected.

## Additional broadcast data

The next useful SDK fields should be added only with a graphic or production decision in mind:

1. Starting position and derived position gain/loss.
2. Tire compound and qualifying-compound lock state.
3. IndyCar push-to-pass availability, activation, and remaining count.
4. Pace row, pace line, and per-car pace flags for grids and restarts.
5. Weather and track conditions for race-status graphics.
6. Radio-transmitting car for an automatic radio identifier.

`cameraGroups`, `activeCameraCarIdx`, `activeCameraGroup`, and `activeCamera` report the current session's available camera inventory and observed camera selection. They are optional so older diagnostic captures remain replay-compatible. Camera changes still travel through the separate command path: `focus.set` and `camera.take` produce a server-to-client `camera.command`, and the telemetry client returns a `camera.result` after handing the request to the SDK.
