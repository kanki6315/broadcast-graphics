# Race history

Production race history is stored in PostgreSQL as semantic timing records. Raw high-frequency telemetry remains in server memory and is not written to the database.

## Tables

- `bg_broadcast_sessions`: one practice, qualifying, or race session, separated by telemetry source mode (`live`, `replay`, or `simulation`).
- `bg_session_classes`: classes observed within a session.
- `bg_session_entries`: the classified car/team entry identified by session and iRacing `carIdx`.
- `bg_session_drivers`: drivers observed in an entry, allowing a team entry to have multiple drivers.
- `bg_completed_laps`: the official completed lap time and its matching scoring-line result.

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
