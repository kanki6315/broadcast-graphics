# Telemetry contract

The Windows client owns iRacing-specific interpretation. The server and graphic packages receive normalized broadcast facts and must not reinterpret SDK variables.

## Delivery and health

The client sends normalized telemetry at up to 10 Hz. Every new client frame carries a positive, connection-scoped `sequence` number. After the server parses the frame, applies it to live state, and offers it to race-history processing, it replies on the ingestion socket with:

```json
{ "type": "telemetry.ack", "sequence": 42 }
```

Acknowledgements are cumulative because WebSocket messages are ordered. An acknowledgement does not promise that a newly observed completed lap has already committed to PostgreSQL; race-history persistence remains asynchronous and idempotent.

The Windows health indicators have separate meanings:

- **Server** means the ingestion WebSocket is established.
- **iRacing source** means the SDK is nominally connected and producing raw callbacks.
- **Data stream** means normalized telemetry was acknowledged recently by the server.

If the oldest outstanding frame remains unacknowledged for three seconds, the client reconnects only the WebSocket and resends the newest unacknowledged snapshot. If a live SDK source reports connected but produces no raw callback for ten seconds initially, or three seconds after frames have begun, the client disposes and recreates only the SDK source. Diagnostic replay pause and completion do not run the live-source watchdog.

During rollout, the server continues accepting sequence-less frames from older clients but cannot acknowledge them. Deploy the acknowledgement-capable server before deploying the acknowledgement-dependent Windows client.

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
| `position` / `classPosition` | One-based overall and class running positions. During active racing these are ordered by cumulative race distance (`CarIdxLap` plus `CarIdxLapDistPct`), because `CarIdxPosition` and `CarIdxClassPosition` are scoring positions rather than live spatial order. SDK positions remain the fallback for cars without usable location data and become authoritative again after racing ends. Session-result class positions are converted from iRacing's zero-based values. |
| `startingPosition` / `startingClassPosition` | Immutable race-start baselines captured only while the field is still on its first race lap. They remain `null` when the client joined too late to establish a trustworthy start. |
| `positionChange` / `classPositionChange` | Starting position minus current position. Positive values mean places gained and negative values mean places lost. |
| `gapToLeader` | Race-only moving time gap in seconds to the overall leader when the cars are on the same completed lap. It is interpolated from shared track-position crossings, with `CarIdxF2Time` as the scoring fallback. |
| `intervalToAhead` | Race-only moving time gap in seconds to the preceding overall-position car, measured at a shared track position. |
| `classGapToLeader` | Race-only time gap to the driver's class leader. |
| `classIntervalToAhead` | Race-only time gap to the preceding class-position car. |
| `lapsBehindLeader` / `lapsBehindClassLeader` | Whole-lap race-distance deficit. This avoids briefly marking the field one lap down when a leader crosses start/finish first. When nonzero, the corresponding seconds gap is `null` instead of showing a misleading time. |
| `interval` | Compatibility alias for `gapToLeader`. New graphics should not use it. |

During a race, the live bridge uses `CarIdxLap` and `CarIdxLapDistPct` to update overall and class order on every telemetry frame. It also combines those fields with `SessionTime` to record when each car reaches sampled positions around the circuit. Once the reference car's history brackets another car's current position, the bridge interpolates their separation at that shared position. `CarIdxF2Time` supplies the authoritative scoring fallback while that short history warms up. In practice and qualifying it represents a lap-time value, so the normalized gap fields are deliberately `null`.

## Lap-time graphics

The normalized driver state contains:

- `lastLap` and `lastLapNumber`: the most recently completed lap time and the lap it belongs to;
- `bestLap` and `bestLapNumber`: the driver's session-best lap and its lap number;
- `currentLap` and `lapDistPct`: the lap being driven and approximate progress around it.

These fields support trustworthy last-lap, personal-best, class-best, session-best, and comparison graphics. A graphic should only announce a new lap when `lastLapNumber` advances; repeated telemetry frames are not new laps.

There is no reliable per-car live current-lap stopwatch in the available spectator data. Do not synthesize one from `lapDistPct`. If a live estimate is added later, it must be labeled as an estimate.

The client also pairs a completed race lap with `ResultsPositions.Time` only when the result's completed-lap number matches `lastLapNumber`. This produces `lastLapGapToLeader`, a scoring-line gap rather than a sampled in-lap estimate. Overall and class lap deficits remain separate from seconds gaps.

The server converts matching lap results into durable completed-lap records. It deduplicates them by session, entry, and lap number, and emits `lap.completed` only after the database insert succeeds. The resulting history supports lap-time and scoring-gap trends, deltas to personal/class/session best, consistency, stint analysis, and automatic fastest-lap cues.

## Timing quality, provenance, and sectors

Official iRacing facts and local calculations remain separate:

- `lastLap`, `lastLapNumber`, `bestLap`, and `bestLapNumber` are authoritative iRacing facts. A dirty locally derived sector never clears or invalidates them.
- Moving gaps and `DriverState.sectors` are locally derived by `TrackTimingTracker` from `SessionTime`, `CarIdxLap`, and `CarIdxLapDistPct` samples.
- Every derived result carries `source: "derived"`; official timing metadata carries `source: "iracing"`.

`TimingQuality` has four values. `valid` passed all lifecycle and continuity checks. `inferred` has a defensible value containing an explicitly identified inference. `incomplete` lacks enough clean evidence for a value. `invalid` was affected by a known discontinuity. Invalidity reasons are `telemetry-gap`, `lap-jump`, `position-reset`, `implausible-movement`, `tow`, `pit-transition`, `invalid-crossing-order`, `session-transition`, `insufficient-samples`, and `definition-mismatch`. Missing and invalid values are absent/null, never zero.

The optional session `sectorDefinition` comes only from `SessionInfo.SplitTimeInfo.Sectors`. The Windows client orders the variable-length `SectorNum`/`SectorStartPct` list, requires a usable start/finish boundary, associates it with the session and track identity, and hashes those facts into a stable `iracing-…` revision. It does not invent boundaries when the SDK definition is absent or unusable. A definition change resets the local lifecycle; results from different revisions never share rankings.

Each optional `DriverState.sectors` contains the current sector number plus completed sectors for the current and previous lap. A completed sector includes lap, sector number, elapsed value when available, revision, completion/observation session time, source, quality, invalidity reason, and valid-only comparison labels. Only `valid` derived sectors can become personal, class, or overall fastest or support pace comparisons. Before a complete set is accepted, its sum must reconcile with the official completed lap within `max(0.5 seconds, 1% of the official lap time)`, which accommodates sampling/interpolation error without accepting a definition mismatch.

## Track and connection state

`trackStatus` is one of `running`, `pit`, `off-track`, `not-in-world`, `retired`, or `unknown`. `isConnected` indicates whether the car is represented in the current world; it does not mean that the driver's telemetry client is connected.

The optional `pitState` is deliberately separate and is one of `not-in-pits`, `pit-lane`, `pit-stall`, or `unobserved`. A car becoming unobserved does not imply movement or a pit exit. `latestPitVisit` remains open until an observed return to track and separately reports pit-lane, observed box, inferred box, and unknown time.

Only an unobserved interval bracketed by `pit-stall` on both sides contributes to `inferredBoxTime`. Stall-to-lane, stall-to-track, lane-to-lane, lane-to-stall, and lane-to-track disappearances all remain `unknownTime`. While a car is still absent, the unresolved interval is shown as unknown and the visit quality is `incomplete`. A driver identity change marks the visit but never splits it.

`timingQuality` adds `source`, `quality`, and an optional invalidity reason to named driver timing fields while retaining the existing numeric fields for replay compatibility. New clients send it; old captures may omit it.

The server adds an optional, session-scoped `LiveState.intelligence` snapshot. It contains stabilized same-class battles, bounded-window gap trends, pit cycles, driver stints, and quality warnings. This snapshot is calculated once from normalized telemetry and shared by all viewers; browser filters never change its canonical quality or conclusions.

## Additional broadcast data

The next useful SDK fields should be added only with a graphic or production decision in mind:

1. Tire compound and qualifying-compound lock state.
2. IndyCar push-to-pass availability, activation, and remaining count.
3. Pace row, pace line, and per-car pace flags for grids and restarts.
4. Weather and track conditions for race-status graphics.
5. Radio-transmitting car for an automatic radio identifier.

`cameraGroups`, `activeCameraCarIdx`, `activeCameraGroup`, and `activeCamera` report the current session's available camera inventory and observed camera selection. They are optional so older diagnostic captures remain replay-compatible. Camera changes still travel through the separate command path: `focus.set`, `camera.group.take`, `camera.driver.take`, and the compatibility `camera.take` action produce a server-to-client `camera.command`; the telemetry client returns a `camera.result` after handing the request to the SDK. `camera.driver.take` carries both `carIdx` and `cameraGroup` so a timing-row context-menu choice updates shared focus and dispatches one atomic camera request.
