import assert from "node:assert/strict";
import test from "node:test";
import type { DriverState, SessionState } from "@racecontrol/protocol";
import { RaceStateProjection } from "./race-state-projection.js";

function driver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    carIdx: 7, position: 4, carNumber: "23", name: "Driver", team: "Team", className: "GT3",
    interval: 2, lastLap: 82, bestLap: 81, lapsCompleted: 0, onPitRoad: false, incidents: 0,
    classId: 1, classColor: "#fff", classPosition: 3, gapToLeader: 2, intervalToAhead: 1,
    classGapToLeader: 2, classIntervalToAhead: 1, lapsBehindLeader: 0, lapsBehindClassLeader: 0,
    currentLap: 1, lastLapNumber: null, bestLapNumber: null, lapDistPct: 0.2, trackStatus: "running",
    isConnected: true, userId: 41, teamId: 42, carId: 43, lastLapPosition: null,
    lastLapClassPosition: null, lastLapGapToLeader: null, lastLapGapToClassLeader: null,
    lastLapLapsBehindLeader: null, lastLapLapsBehindClassLeader: null,
    ...overrides,
  };
}

function session(currentDriver: DriverState): SessionState {
  return {
    id: "race", name: "Race", type: "race", trackName: "Track", lap: currentDriver.currentLap,
    totalLaps: 20, timeRemaining: null, flag: "green", timestamp: new Date().toISOString(),
    drivers: [currentDriver], lapsCompleted: currentDriver.lapsCompleted, lapsRemaining: 20,
    timeElapsed: 10, totalTime: null, phase: "racing", startState: "go", flags: ["green"],
    classes: [{ id: 1, name: "GT3", color: "#fff", carCount: 1 }], source: "iracing",
    sourceMode: "live", externalSubSessionId: 1, externalSessionNumber: 0, trackId: 2,
  };
}

test("captures the latest pre-race grid and freezes it before the rolling start", () => {
  const projection = new RaceStateProjection();
  const warmup = session(driver({ position: 5, classPosition: 4 }));
  warmup.phase = "warmup";
  const parade = session(driver());
  parade.phase = "parade-laps";
  projection.apply(warmup);
  const grid = projection.apply(parade);
  const start = projection.apply(session(driver({ position: 3, classPosition: 2 })));
  const moved = projection.apply(session(driver({ position: 2, classPosition: 1, lapsCompleted: 2, currentLap: 3, userId: 99 })));

  assert.equal(grid.drivers[0]?.startingPosition, 4);
  assert.equal(start.drivers[0]?.startingPosition, 4);
  assert.equal(moved.drivers[0]?.startingPosition, 4);
  assert.equal(moved.drivers[0]?.startingClassPosition, 3);
  assert.equal(moved.drivers[0]?.positionChange, 2);
  assert.equal(moved.drivers[0]?.classPositionChange, 2);
});

test("position change survives a disconnect, reconnect, and driver change", () => {
  const projection = new RaceStateProjection();
  const grid = session(driver());
  grid.phase = "parade-laps";
  projection.apply(grid);
  const start = projection.apply(session(driver()));
  const missing = projection.apply(session(driver({
    position: 3,
    classPosition: 2,
    lapsCompleted: 1,
    currentLap: 2,
    pitState: "unobserved",
    trackStatus: "not-in-world",
    isConnected: false,
  })));
  const reconnected = projection.apply(session(driver({
    position: 2,
    classPosition: 1,
    lapsCompleted: 2,
    currentLap: 3,
    userId: 99,
  })));

  assert.equal(start.drivers[0]?.startingPosition, 4);
  assert.equal(missing.drivers[0]?.startingPosition, 4);
  assert.equal(reconnected.drivers[0]?.startingPosition, 4);
  assert.equal(reconnected.drivers[0]?.startingClassPosition, 3);
  assert.equal(reconnected.drivers[0]?.positionChange, 2);
  assert.equal(reconnected.drivers[0]?.classPositionChange, 2);
});

test("position baseline survives a projection restart", () => {
  const before = new RaceStateProjection();
  const grid = session(driver());
  grid.phase = "parade-laps";
  before.apply(grid);
  const checkpoint = before.checkpoint()!;
  const after = new RaceStateProjection();
  after.restore(checkpoint);
  const resumed = after.apply(session(driver({ position: 2, classPosition: 1, lapsCompleted: 2, currentLap: 3 })));

  assert.equal(resumed.drivers[0]?.startingPosition, 4);
  assert.equal(resumed.drivers[0]?.startingClassPosition, 3);
  assert.equal(resumed.drivers[0]?.positionChange, 2);
});

test("preserves explicit unavailable baselines from a late-joining telemetry client", () => {
  const projection = new RaceStateProjection();
  const late = projection.apply(session(driver({
    lapsCompleted: 5,
    currentLap: 6,
    startingPosition: null,
    startingClassPosition: null,
  })));
  const reconnected = projection.apply(session(driver({ position: 2, classPosition: 1, lapsCompleted: 6, currentLap: 7 })));

  assert.equal(late.drivers[0]?.positionChange, null);
  assert.equal(reconnected.drivers[0]?.startingPosition, null);
  assert.equal(reconnected.drivers[0]?.positionChange, null);
});
