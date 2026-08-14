# Commentator timing plan

This plan describes a read-only timing workspace for commentators following the live stories of an endurance, multiclass race. It is intentionally separate from camera and graphics control. The workspace must remain useful on either a full monitor or half of a monitor and must not depend on historical editorial context such as a driver's previous wins.

The primary questions it should answer are:

- Which cars are in a meaningful class battle?
- Is a gap opening or closing?
- Which cars are offset by their pit cycle?
- Who is driving each car, and when did the stint change?
- How much time did a stop spend in the pit lane, in the box, or unobserved?
- Are the displayed sector and trend values trustworthy?

## Architecture

```text
iRacing SDK
    -> TelemetrySnapshotMapper
        -> TrackTimingTracker
        -> PitTimingTracker
    -> normalized SessionState
    -> server telemetry ingestion
    -> RaceIntelligenceService
        -> shared in-memory intelligence snapshot
        -> persistent completed events and race history
    -> commentator timing clients
```

The Windows client owns interpretation that depends on iRacing SDK variables and high-frequency samples. The server owns session-wide race intelligence derived from normalized facts. Browser clients own only presentation and user-specific view state.

`RaceIntelligenceService` is a session-scoped background projection. It processes each telemetry update once, maintains bounded histories, and publishes a shared immutable snapshot. Opening or refreshing a timing page must not cause a database query or recalculate race intelligence for that user. Class filters, row expansion, selected cars, sorting, and column preferences remain local to the browser.

Database reads are reserved for server restart recovery, explicit historical inspection, and replay. Completed semantic events are persisted asynchronously and idempotently; raw high-frequency telemetry remains in memory.

## Increment 1: race-ready commentator timing

### Read-only commentator workspace

- Add a commentator access role or read-only mode for `/timing`.
- Remove camera and graphics actions from this mode.
- Support dense full-monitor and half-monitor layouts.
- Store each user's class filter, selected car, expanded rows, and visible columns locally.
- Keep the current operator workflow available separately for users who control cameras.

### Class-centric timing table

The primary table should include:

- overall and class position;
- positions gained or lost since the race start;
- current lap number and lap progress;
- gap to the overall leader and class leader;
- interval to the car ahead overall and in class;
- last and best lap;
- current driver and recent driver change;
- track, pit-lane, pit-stall, disconnected, and uncertain status;
- sector values when the sector work in Increment 2 is available.

Rows should emphasize nearby class competitors and active battles. Selecting a row changes the timing-page focus only; it does not issue a camera command.

### Linear track ribbon

- Position cars using current lap and `CarIdxLapDistPct`.
- Group and color cars by class.
- Emphasize the selected car and its nearby class competitors.
- Represent pit-lane cars separately from cars circulating on track.
- Provide a useful linear fallback before circuit geometry is available.

### Position change

- Capture each entry's starting position and starting class position once the race start is established.
- Derive overall and class positions gained or lost from those immutable starting values.
- Do not reset the baseline during a reconnect or driver change.
- Mark the value unavailable if the server joined too late to establish a trustworthy baseline.

### Pit timing

`PitTimingTracker` maintains one persistent visit for each car from pit entry until a defensible pit exit. Telemetry presence is separate from physical track state: a car disappearing never means that it moved or left its stall.

The expected state progression is:

```text
on track -> pit lane -> pit stall -> pit lane -> on track
                           |
                      unobserved
                           |
               pit stall / pit lane / on track
```

For every unobserved interval, retain:

- the last observed state;
- the first state after reappearance;
- the interval's start, end, and duration;
- whether a driver identity change occurred;
- how the interval was classified and why.

Classify gaps with the following rules:

| State before the gap | State after the gap | Duration classification |
| --- | --- | --- |
| `InPitStall` | `InPitStall` | Inferred box time |
| `InPitStall` | Pit lane | Unknown time |
| `InPitStall` | On track | Unknown time |
| Pit lane | Pit lane | Unknown time |
| Pit lane | On track | Unknown time |
| On track | On track | Unknown timing gap |
| Any state | Still absent | Unresolved unknown time |

An unobserved interval is included in box time only when it is bracketed by `InPitStall` observations on both sides. It must also be recorded as inferred so diagnostics and the UI can distinguish it from directly observed box time. A gap with `InPitStall` on only one side remains unknown.

Track these pit-visit totals separately:

```ts
interface PitVisitTiming {
  pitEntryTime: number;
  pitExitTime?: number;
  pitLaneTime: number;
  boxTime: number;
  unknownTime: number;
  observedBoxTime: number;
  inferredBoxTime: number;
  driverChange: boolean;
  entryDriverId?: string;
  exitDriverId?: string;
  quality: "valid" | "contains-inference" | "incomplete";
}
```

`boxTime` is the sum of observed and inferred box time. Unknown time is never silently added to pit-lane or box time.

The pit visit remains open while the car is absent. If the car reappears on track, close the visit with an estimated exit boundary and retain the unresolved interval as unknown. A driver identity change on the same car creates a stint boundary but does not create a second pit visit.

## Increment 2: reliable timing intelligence

### TrackTimingTracker

Refactor `LiveTimingTracker` into `TrackTimingTracker` rather than adding a second independent sample tracker. One per-car distance/time buffer and interpolation implementation should support both moving gaps and derived sectors.

Responsibilities include:

- observing high-frequency per-car distance and session-time samples;
- interpolating when a car crossed a specified track position;
- calculating moving overall and class gaps at a shared position;
- detecting sector crossings;
- detecting missing samples, discontinuities, lap jumps, resets, and implausible movement;
- managing per-lap and per-sector lifecycle state;
- returning timing values with source, quality, and invalidity reasons.

A representative API is:

```text
Observe
GetCrossingTime
GetGapAtPosition
GetCompletedSectorTimes
```

### Timing quality and provenance

Every locally derived timing result carries provenance and quality:

```ts
interface TimingValue {
  value?: number;
  source: "iracing" | "derived";
  quality: "valid" | "inferred" | "incomplete" | "invalid";
  reason?: InvalidTimingReason;
}
```

Invalidity reasons include:

- telemetry gap;
- lap-number jump;
- position reset or implausible movement;
- tow or return to pits;
- pit transition;
- sector crossings observed in the wrong order;
- session transition;
- insufficient samples around a boundary.

A derived sector is valid only when the car was continuously observed across both boundaries, both crossings can be interpolated from sufficiently close samples, lap distance progressed plausibly, and no reset, tow, pit discontinuity, or material telemetry gap affected it.

Never interpolate a sector across a disappearance. If a car disappears and reappears farther around the circuit, invalidate the affected sector and lap. Only `valid` derived sectors may participate in personal-best, class-fastest, overall-fastest, purple/green highlighting, pace comparisons, or gap-trend calculations. Inferred, incomplete, and invalid results may be shown, but never described or styled as fastest.

iRacing-provided last-lap and best-lap facts remain distinct from locally derived sectors. Dirty derived data must not overwrite or invalidate an otherwise authoritative iRacing lap time.

### Sector definitions

- Read the variable number of native boundaries from `SessionInfo.SplitTimeInfo.Sectors` using `SectorNum` and `SectorStartPct`.
- Store the ordered boundaries as lap-distance percentages.
- Associate each timing result with a versioned session sector definition.
- Record whether the definition came from iRacing or a custom configuration.
- Label locally calculated sector values as derived timing.

### Sector persistence

Persist completed semantic sector results, not every live partial-sector update. A stored result includes:

- session, entry, driver, lap, and sector number;
- sector-definition revision;
- sector elapsed time;
- timing source and quality;
- invalidity reason when applicable.

Suggested storage separates session sector definitions, their ordered boundary points, and completed lap sectors. Repeated frames and reconnects must be idempotent. Sector totals should approximately reconcile with the completed lap time before they are considered valid.

### Driver stints

- A driver identity change on the same entry ends the old stint and starts the new one.
- The identity change does not end the car's pit visit or reset its race history.
- Record whether the change occurred during observed box time, inferred box time, or an unresolved gap.
- Preserve the entry's lap, position, and pit-cycle continuity across the change.
- Treat a driver change observed away from a credible pit visit as suspect data rather than creating a normal stop narrative.

### RaceIntelligenceService

Run one service for the active session. It consumes normalized telemetry and completed history events, then incrementally maintains:

- gap histories and opening/closing rates;
- overall and class battles;
- pit cycles and recent stops;
- driver stints and changes;
- position changes;
- timing quality warnings.

High-frequency observations can update internal buffers on every telemetry frame. Commentator-facing stories should be stabilized and published on a slower cadence, initially 1-2 Hz, so small sampling changes do not cause the UI to flicker.

The shared snapshot should include its generation time and enough quality metadata for callers to present uncertainty:

```ts
interface RaceIntelligenceSnapshot {
  generatedAt: number;
  battles: BattleSummary[];
  gapTrends: GapTrend[];
  pitCycles: PitCycleSummary[];
  stints: DriverStintSummary[];
  qualityWarnings: TimingQualityWarning[];
}
```

Ordinary timing requests read this cached snapshot. They do not query persisted history or derive a separate result for each caller. On server restart, rebuild what can be recovered from durable history, then clearly mark intelligence that still lacks a sufficient live observation window.

### Battle and trend rules

- Calculate battle candidates within class first; an overall proximity between different classes is not automatically a competitive battle.
- Compare gaps over bounded windows rather than only the last two samples.
- Suppress closing/opening claims during material telemetry gaps, pit transitions, cautions, or insufficient history.
- Carry the source window and quality with each trend.
- Keep lapped-car deficits separate from same-lap time gaps.
- Avoid ranking dirty sectors or using them to support a pace story.

## Increment 3: circuit map and sector configuration

### Track geometry

`CarIdxLapDistPct` is one-dimensional and cannot reconstruct circuit geometry by itself. Use a cached track asset or imported SVG centerline, then calibrate:

- start/finish position;
- travel direction;
- normalized distance along the path;
- track-layout identity and calibration revision.

Map each car's lap-distance percentage to path length. Retain the linear ribbon whenever geometry is missing or unverified.

### Sector editor

- Initialize sector markers from iRacing's native split points.
- Allow an authorized user to drag, add, or delete points on the calibrated centerline.
- Map the selected path position back to lap-distance percentage.
- Preview sector ranges and ordering before saving.
- Lock the active definition when racing begins.
- Create a new revision for later edits and reset comparisons that depend on the old definition.

Sector results created with different definition revisions must never share fastest-time rankings.

## Presentation of uncertain data

Uncertainty should be visible without overwhelming the commentator:

- a plain value is directly observed or validly derived;
- a value with a subtle marker such as `~` contains inference;
- `--` means unavailable, incomplete, or invalid;
- row expansion or a tooltip explains the source and reason;
- uncertain timing never receives fastest-sector styling;
- official iRacing lap values and local derived-sector values keep separate provenance.

For pit timing, show pit-lane, box, and unknown totals independently. If box time contains a gap bracketed by stall observations, the displayed box total includes it and is marked as inferred. Do not present unresolved time as if the car was known to be moving or stationary.

## Delivery order

Implement and verify the work in this order:

1. Read-only commentator route or role.
2. Class-centric table and full/half-monitor layouts.
3. Linear track ribbon.
4. Existing lap, gap, interval, best-lap, and last-lap data.
5. Starting-position capture and position gain/loss.
6. Pit-lane, pit-stall, unknown-time, and driver-change tracking.
7. Shared `TrackTimingTracker` sampling engine.
8. Timing quality and provenance throughout the protocol.
9. Native sector definitions, derived sector timing, and persistence.
10. Cached `RaceIntelligenceService`, battle detection, and gap trends.
11. Driver-stint summaries and pit-cycle intelligence.
12. Track SVG acquisition and calibration.
13. Sector configuration editor and definition revisions.

Protocol additions should be optional during rollout so existing diagnostic captures and older telemetry clients remain replay-compatible.

### Frozen Increment 1 foundation contracts

The serial foundation for Increment 1 lives in `packages/protocol/src/index.ts`. During parallel implementation, that file has a single owner; table and ribbon sessions consume its exported contracts without editing it.

- `DriverState.pitState` carries `not-in-pits`, `pit-lane`, `pit-stall`, or `unobserved` independently of the legacy `trackStatus` field.
- `DriverState.latestPitVisit` uses `PitVisitTiming`. An omitted field means the producer does not support pit summaries; `null` means it supports them but has no visit to report. `pitExitTime` distinguishes an open visit from a completed visit.
- `startingPosition` and `startingClassPosition` are immutable once established. Their matching change fields are positive for positions gained, negative for positions lost, and `null` when the baseline is not trustworthy.
- `timingQuality` adds source, quality, and an optional invalidity reason to named timing fields without replacing the legacy numeric values during rollout. The reusable `TimingValue` contract carries a value when later derived timing results need value and metadata together.
- `TimingWorkspaceMode` identifies `operator` and read-only `commentator` behavior. It is optional on the socket hello message until the server enforces the permission boundary.
- `apps/web/src/timing-table.tsx` owns the timing table. `apps/web/src/linear-track-ribbon.tsx` and its colocated stylesheet own the ribbon. Both are presentation components driven by `DriverState[]`, the selected car, and a local selection callback; neither owns socket commands or shared state.

## Verification and acceptance criteria

### Pit timing

- A car that disappears from `InPitStall` and returns to `InPitStall` remains in one pit visit; the missing duration is included in `inferredBoxTime` and `boxTime`.
- A car that disappears from `InPitStall` and returns in pit lane or on track remains in one visit; the missing duration is included only in `unknownTime`.
- A car that disappears from pit lane and returns on track does not receive invented lane or box time.
- A driver change during a disappearance does not split the pit visit.
- A visit that is still absent remains open and incomplete.
- Observed box time, inferred box time, and unknown time reconcile with the visit duration without overlap.

### Sectors and gaps

- Boundary interpolation works across start/finish and with a variable sector count.
- No derived sector bridges a telemetry disappearance, lap jump, tow, reset, or invalid pit transition.
- Invalid or inferred sectors cannot become personal, class, or overall fastest.
- Official last/best laps remain available when local sector derivation is invalid.
- Moving gaps retain the existing scoring fallback while sample history warms up.

### Intelligence service

- Multiple commentator clients receive the same generation of the shared intelligence snapshot.
- Connecting or refreshing a client does not trigger history queries or full recomputation.
- Trends remain suppressed until their observation window is sufficient and clean.
- A restart exposes recovered history separately from intelligence that requires a new live buffer.

### Interface

- A 41-car, two-class field remains scannable at full-monitor and half-monitor widths.
- Class battles, pit-cycle offsets, driver changes, and dirty data can be distinguished without opening another page.
- Commentator row interactions never send camera or graphics commands.
- Replay fixtures cover reconnects, long pit stops, driver changes, missing cars, and cars reappearing at discontinuous track positions.
