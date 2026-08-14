# Race history

Production race history is stored in PostgreSQL as semantic timing records. Raw high-frequency telemetry remains in server memory and is not written to the database.

## Tables

- `bg_broadcast_sessions`: one practice, qualifying, or race session, separated by telemetry source mode (`live`, `replay`, or `simulation`).
- `bg_session_classes`: classes observed within a session.
- `bg_session_entries`: the classified car/team entry identified by session and iRacing `carIdx`.
- `bg_session_drivers`: drivers observed in an entry, allowing a team entry to have multiple drivers.
- `bg_completed_laps`: the official completed lap time and its matching scoring-line result.
- `bg_sector_definitions`: one versioned native iRacing sector definition per session/revision.
- `bg_sector_definition_points`: the ordered sector number and start percentage for a definition.
- `bg_completed_sectors`: semantic per-entry, driver-at-completion sector results, including provenance and quality.

The server creates these tables at startup when `DATABASE_URL` is configured. Local development without a database uses an in-memory history repository.

## Completed-lap semantics

A race lap is eligible for storage only when all of the following refer to the same completed lap:

- `lastLapNumber` and `lastLap` from per-car telemetry;
- result position and class position;
- the race scoring gap from `ResultsPositions.Time`;
- overall and class lap deficits.

Same-lap gaps are stored in integer milliseconds. A lapped entry stores its lap deficit and a null seconds gap. Practice and qualifying laps do not require a race gap.

`UNIQUE (session_id, entry_id, lap_number)` makes reconnects and repeated telemetry frames idempotent. A diagnostic replay has its own source mode and cannot add laps to the corresponding live session.

The history contains laps whose completed result was observed while the client and server were operating. After an outage, the latest available completed lap can be recovered and deduplicated, but earlier laps missed during that outage cannot be reconstructed from the current SDK snapshot.

## Completed-sector semantics

Completed sectors persist asynchronously; raw distance/time samples do not. Each row references its session, entry, driver, and sector-definition revision and stores lap/sector number, elapsed milliseconds when available, timing source, quality, invalidity reason, completion session time, and observation timestamp.

`UNIQUE (session_id, entry_id, lap_number, sector_number, definition_id)` makes repeated frames and reconnects idempotent. A definition revision is a foreign key, so different revisions cannot accidentally rank together. Invalid and incomplete results may have a null elapsed value; they remain useful diagnostic evidence and are never rewritten as zero. A valid complete lap must reconcile with the official lap within `max(0.5 seconds, 1% of lap time)` before its sectors can participate in fastest rankings.

The in-memory repository implements the same keys for local development. Startup uses `CREATE TABLE IF NOT EXISTS`, so databases containing only the completed-lap tables can add sector storage safely.

## Cached race intelligence

`RaceIntelligenceService` consumes each normalized live update once and keeps at most 30 seconds of same-class gap samples in memory. It publishes an immutable shared snapshot on a 750 ms cadence (approximately 1.3 Hz). Opening or refreshing a commentator page reads `StateStore` and neither queries this history repository nor creates a per-browser projection. Class/selected-car filters are browser-only presentation state.

Gap claims require at least three clean samples spanning five seconds. Pit transitions, telemetry gaps, resets, tows, cautions, session changes, and whole-lap deficits suppress them. Whole-lap deficit remains a separate integer and never becomes a seconds-gap story. Driver stint boundaries are reconstructable from normalized driver identity and pit visits; a change is classified as observed box, inferred box, unresolved, or suspect away from pits without splitting the car's pit visit.

After a server restart, durable lap/sector history remains available to explicit history/replay paths, while new opening/closing claims stay `insufficient-history` until the live buffer warms up. Ordinary live-state refreshes do not perform recovery queries.

## Consumers

After a successful insert, connected control panels and overlays receive a `lap.completed` WebSocket message. They may request up to 200 recent laps for a car with:

```json
{ "type": "lap.history.request", "carIdx": 7, "limit": 20 }
```

The response is a `lap.history` message ordered from oldest to newest. An authenticated control-panel session can inspect the same active-session data with:

```text
GET /api/history/laps?carIdx=7&limit=20
```

Derived values such as gap gained/lost, average pace, consistency, and fastest-lap rankings should be calculated from these immutable records rather than stored as independent facts.

## Replaying an endurance diagnostic capture

When the representative capture arrives:

1. Keep the ZIP outside the repository; do not unpack or commit it.
2. In the Windows client, choose **Diagnostic replay**, select the ZIP, and verify the reported format, session sequence, track, 41-car field, and two classes.
3. Select maximum speed for deterministic validation, connect it to a local server, and wait for replay completion.
4. Run `dotnet test client/TelemetryClient.Tests/TelemetryClient.Tests.csproj --no-restore --nologo` and `npm test` before and after replay to preserve fixture baselines.
5. Inspect `/timing` for sector revision, dirty-sector markers, same-class Battle Watch entries, driver changes, pit-cycle continuity, and quality warnings. Confirm commentator interactions issue no camera or graphics commands.
6. Query `GET /api/history/laps?carIdx=<idx>&limit=20` only for explicit lap review. Sector validation currently uses repository/integration diagnostics; ordinary page refreshes must not cause database reads.
7. Compare any capture-specific discontinuities with `TrackTimingTracker` results. Add a minimized deterministic regression fixture for every newly observed edge case rather than committing the capture.

Format-1 normalized captures without Increment 1 or Increment 2 optional fields continue to deserialize and replay. SDK captures are reconstructed through the current mapper, so native sector definitions are used when their recorded session YAML supplies `SplitTimeInfo`.
