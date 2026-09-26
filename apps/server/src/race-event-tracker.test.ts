import assert from "node:assert/strict";
import test from "node:test";
import type { DriverState, SessionState } from "@racecontrol/protocol";
import { RaceEventTracker } from "./race-event-tracker.js";

function driver(carIdx: number, classPosition: number, lapDistPct: number, overrides: Partial<DriverState> = {}): DriverState {
  return {
    carIdx, position: classPosition, carNumber: String(carIdx), name: `Driver ${carIdx}`, team: `Team ${carIdx}`,
    className: "GT3", interval: null, lastLap: 80, bestLap: 79, lapsCompleted: 4, onPitRoad: false,
    incidents: 0, classId: 1, classColor: "#fff", classPosition, gapToLeader: null, intervalToAhead: null,
    classGapToLeader: null, classIntervalToAhead: null, lapsBehindLeader: 0, lapsBehindClassLeader: 0,
    currentLap: 5, lastLapNumber: 4, bestLapNumber: 3, lapDistPct, trackStatus: "running", pitState: "not-in-pits",
    timingQuality: { lapDistPct: { source: "iracing", quality: "valid" } }, isConnected: true,
    userId: carIdx, teamId: carIdx, carId: 1, lastLapPosition: classPosition, lastLapClassPosition: classPosition,
    lastLapGapToLeader: null, lastLapGapToClassLeader: null, lastLapLapsBehindLeader: 0, lastLapLapsBehindClassLeader: 0,
    ...overrides,
  };
}

function session(timestamp: string, drivers: DriverState[], overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "race-1", name: "Race", type: "race", trackName: "Circuit", lap: 5, totalLaps: 20,
    timeRemaining: null, flag: "green", timestamp, drivers, lapsCompleted: 4, lapsRemaining: 15,
    timeElapsed: 120, totalTime: null, phase: "racing", startState: "go", flags: ["green"],
    classes: [{ id: 1, name: "GT3", color: "#fff", carCount: drivers.length }], source: "iracing",
    sourceMode: "live", externalSubSessionId: 1, externalSessionNumber: 0, trackId: 1, ...overrides,
  };
}

test("detects an adjacent same-class pass when both cars remain close and running", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50), driver(8, 1, .515)]));
  const events = tracker.update(session("2026-01-01T00:00:01.000Z", [driver(7, 1, .52), driver(8, 2, .525)]));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "pass");
  assert.equal(events[0]?.primaryCarIdx, 7);
  assert.equal(events[0]?.secondaryCarIdx, 8);
});

test("suppresses position swaps caused by pit transitions, distance gaps, and cautions", () => {
  for (const changed of [
    session("2026-01-01T00:00:01.000Z", [driver(7, 1, .52), driver(8, 2, .525, { onPitRoad: true, pitState: "pit-lane", trackStatus: "pit" })]),
    session("2026-01-01T00:00:01.000Z", [driver(7, 1, .70), driver(8, 2, .20)]),
    session("2026-01-01T00:00:01.000Z", [driver(7, 1, .52), driver(8, 2, .525)], { flag: "yellow" }),
  ]) {
    const tracker = new RaceEventTracker();
    tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50), driver(8, 1, .515)]));
    assert.deepEqual(tracker.update(changed), []);
  }
});

test("detects a likely crash from an off-track position loss without requiring incident data", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50)]));
  const events = tracker.update(session("2026-01-01T00:00:01.000Z", [driver(7, 5, .505, { position: 5, trackStatus: "off-track" })]));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "crash");
  assert.equal(events[0]?.confidence, "likely");
  assert.match(events[0]?.detail ?? "", /off track/);
});

test("does not use incident points alone as a crash trigger and resets events for a new session", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50)]));
  assert.deepEqual(tracker.update(session("2026-01-01T00:00:01.000Z", [driver(7, 2, .51, { incidents: 4 })])), []);
  assert.deepEqual(tracker.update(session("2026-01-01T00:00:02.000Z", [driver(7, 2, .51)], { id: "race-2" })), []);
});

test("detects a spin-like loss from multiple lost positions and near-zero progress", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50)]));
  const events = tracker.update(session("2026-01-01T00:00:01.000Z", [driver(7, 5, .501, { position: 5 })]));
  assert.equal(events[0]?.kind, "crash");
  assert.equal(events[0]?.confidence, "likely");
  assert.match(events[0]?.detail ?? "", /little forward progress/);
});

test("continues detecting after the start lights disappear on lap one", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50), driver(8, 1, .515)], { startState: "go", lap: 1 }));
  tracker.update(session("2026-01-01T00:00:01.000Z", [driver(7, 2, .51), driver(8, 1, .525)], { startState: "hidden", lap: 1 }));
  const events = tracker.update(session("2026-01-01T00:00:02.000Z", [driver(7, 1, .53), driver(8, 2, .535)], { startState: "hidden", lap: 2 }));
  assert.equal(events[0]?.kind, "pass");
  assert.equal(events[0]?.lap, 2);
});

test("retains events beyond the live feed and pages by stable event cursor", () => {
  const tracker = new RaceEventTracker();
  for (let i = 0; i < 65; i++) {
    const a = i * 2, b = a + 1;
    tracker.update(session(new Date(Date.UTC(2026, 0, 1, 0, 0, i * 2)).toISOString(), [driver(a, 2, .50), driver(b, 1, .515)]));
    tracker.update(session(new Date(Date.UTC(2026, 0, 1, 0, 0, i * 2 + 1)).toISOString(), [driver(a, 1, .52), driver(b, 2, .525)]));
  }
  const first = tracker.history(1);
  assert.equal(first.total, 65);
  assert.equal(first.events.length, 50);
  assert.ok(first.nextBefore);
  const older = tracker.history(1, first.nextBefore!);
  assert.equal(older.events.length, 15);
  assert.equal(new Set([...first.events, ...older.events].map((event) => event.id)).size, 65);
  assert.equal(older.nextBefore, null);
  assert.equal(tracker.history(99).total, 0);
});

test("does not infer a pass across a telemetry outage", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50), driver(8, 1, .515)]));
  assert.deepEqual(tracker.update(session("2026-01-01T00:00:20.000Z", [driver(7, 1, .52), driver(8, 2, .525)])), []);
});

test("normal progress at high sample rates is not mistaken for being nearly stopped", () => {
  const tracker = new RaceEventTracker();
  tracker.update(session("2026-01-01T00:00:00.000Z", [driver(7, 2, .50)]));
  assert.deepEqual(tracker.update(session("2026-01-01T00:00:00.100Z", [driver(7, 5, .501)])), []);
});
