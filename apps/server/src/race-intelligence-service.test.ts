import assert from "node:assert/strict";
import test from "node:test";
import type { DriverState, SessionState } from "@racecontrol/protocol";
import { RaceIntelligenceService } from "./race-intelligence-service.js";

function driver(carIdx: number, classId: number, classPosition: number, gap: number | null, overrides: Partial<DriverState> = {}): DriverState {
  return {
    carIdx, position: carIdx + 1, carNumber: String(carIdx + 1), name: `Driver ${carIdx}`, team: `Team ${carIdx}`,
    className: classId === 1 ? "GT3" : "TCR", interval: gap, lastLap: 90, bestLap: 89, lapsCompleted: 10,
    onPitRoad: false, incidents: 0, classId, classColor: classId === 1 ? "#f00" : "#00f", classPosition,
    gapToLeader: gap, intervalToAhead: gap, classGapToLeader: gap, classIntervalToAhead: gap,
    lapsBehindLeader: 0, lapsBehindClassLeader: 0, currentLap: 11, lastLapNumber: 10, bestLapNumber: 8,
    lapDistPct: .5, trackStatus: "running", pitState: "not-in-pits", latestPitVisit: null,
    timingQuality: { classIntervalToAhead: { source: "derived", quality: "valid" } },
    isConnected: true, userId: 1000 + carIdx, teamId: 2000 + carIdx, carId: 1,
    lastLapPosition: carIdx + 1, lastLapClassPosition: classPosition, lastLapGapToLeader: gap,
    lastLapGapToClassLeader: gap, lastLapLapsBehindLeader: 0, lastLapLapsBehindClassLeader: 0,
    ...overrides,
  };
}

function session(at: number, drivers: DriverState[]): SessionState {
  return {
    id: "race", name: "Race", type: "race", trackName: "Spa", lap: 11, totalLaps: null, timeRemaining: null,
    flag: "green", timestamp: new Date(at * 1000).toISOString(), drivers, lapsCompleted: 10, lapsRemaining: null,
    timeElapsed: at, totalTime: null, phase: "racing", startState: "go", flags: ["green"],
    classes: [{ id: 1, name: "GT3", color: "#f00", carCount: 2 }, { id: 2, name: "TCR", color: "#00f", carCount: 1 }],
    source: "iracing", sourceMode: "live", externalSubSessionId: 1, externalSessionNumber: 0, trackId: 1,
  };
}

test("publishes one canonical immutable snapshot and uses bounded gap history", () => {
  let now = 0;
  const service = new RaceIntelligenceService(() => now, 0);
  for (const [at, gap] of [[0, 2], [6, 1.5], [12, 1]] as const) {
    now = at * 1000;
    service.ingest(session(at, [driver(0, 1, 1, 0), driver(1, 1, 2, gap), driver(2, 2, 1, 0)]));
  }

  const first = service.snapshot()!;
  const second = service.snapshot()!;
  assert.equal(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.gapTrends.find((trend) => trend.chasingCarIdx === 1)?.direction, "closing");
  assert.equal(first.battles.length, 1);
  assert.deepEqual(first.battles[0]?.carIdxs, [0, 1]);
  assert.equal(first.battles.some((battle) => battle.carIdxs.includes(2)), false);
});

test("dirty and pit windows suppress trends instead of creating false closing claims", () => {
  const service = new RaceIntelligenceService(() => 0, 0);
  service.ingest(session(0, [driver(0, 1, 1, 0), driver(1, 1, 2, 2)]));
  service.ingest(session(6, [driver(0, 1, 1, 0), driver(1, 1, 2, .2, { onPitRoad: true, pitState: "pit-lane" })]));

  const trend = service.snapshot()!.gapTrends[0]!;
  assert.equal(trend.quality, "invalid");
  assert.equal(trend.suppressionReason, "pit-transition");
  assert.equal(trend.direction, undefined);
});

test("lap deficits stay separate from same-lap time gaps and restart has insufficient live history", () => {
  const service = new RaceIntelligenceService(() => 0, 0);
  service.ingest(session(20, [driver(0, 1, 1, 0, { currentLap: 12 }), driver(1, 1, 2, 9, { currentLap: 11, lapsBehindClassLeader: 1 })]));

  const trend = service.snapshot()!.gapTrends[0]!;
  assert.equal(trend.lapDeficit, 1);
  assert.equal(trend.currentGap, undefined);
  assert.equal(trend.suppressionReason, "lap-deficit");

  const restarted = new RaceIntelligenceService(() => 0, 0);
  restarted.ingest(session(20, [driver(0, 1, 1, 0), driver(1, 1, 2, 1)]));
  assert.equal(restarted.snapshot()!.gapTrends[0]?.suppressionReason, "insufficient-history");
});

test("driver changes retain stint and pit-cycle context for observed, inferred, unresolved, and suspect changes", () => {
  const service = new RaceIntelligenceService(() => 0, 0);
  const initial = [0, 1, 2, 3].map((carIdx) => driver(carIdx, carIdx + 1, 1, 0));
  service.ingest(session(100, initial));
  const visit = { pitEntryTime: 95, pitLaneTime: 3, boxTime: 2, unknownTime: 0, observedBoxTime: 2, inferredBoxTime: 0, driverChange: true, quality: "incomplete" as const };
  service.ingest(session(110, [
    driver(0, 1, 1, 0, { userId: 9000, name: "New 0", pitState: "pit-stall", onPitRoad: true, latestPitVisit: visit }),
    driver(1, 2, 1, 0, { userId: 9001, name: "New 1", pitState: "pit-stall", onPitRoad: true, latestPitVisit: { ...visit, inferredBoxTime: 2 } }),
    driver(2, 3, 1, 0, { userId: 9002, name: "New 2", pitState: "unobserved", isConnected: false, latestPitVisit: { ...visit, unknownTime: 2 } }),
    driver(3, 4, 1, 0, { userId: 9003, name: "New 3" }),
  ]));

  const contexts = new Map(service.snapshot()!.stints.map((stint) => [stint.carIdx, stint.changeContext]));
  assert.equal(contexts.get(0), "observed-box");
  assert.equal(contexts.get(1), "inferred-box");
  assert.equal(contexts.get(2), "unresolved");
  assert.equal(contexts.get(3), "away-from-pits");
  assert.equal(service.snapshot()!.stints.find((stint) => stint.carIdx === 3)?.quality, "invalid");
  assert.equal(service.snapshot()!.pitCycles.find((cycle) => cycle.carIdx === 0)?.stopCount, 1);
});

test("restores stint and pit-cycle state without restoring transient gap history", () => {
  const before = new RaceIntelligenceService(() => 100_000, 0);
  const visit = { pitEntryTime: 90, pitExitTime: 98, pitLaneTime: 8, boxTime: 3, unknownTime: 0, observedBoxTime: 3, inferredBoxTime: 0, driverChange: false, quality: "valid" as const };
  before.ingest(session(100, [driver(0, 1, 1, 0, { latestPitVisit: visit })]));
  const checkpoint = before.checkpoint()!;

  const after = new RaceIntelligenceService(() => 130_000, 0);
  const resumed = session(130, [driver(0, 1, 1, 0, { lapsCompleted: 12, currentLap: 13 })]);
  assert.equal(after.restore(resumed, checkpoint), true);
  after.ingest(resumed);

  assert.equal(after.snapshot()?.stints[0]?.duration, 30);
  assert.equal(after.snapshot()?.stints[0]?.lapCount, 2);
  assert.equal(after.snapshot()?.pitCycles[0]?.totalBoxTime, 3);
  assert.equal(after.snapshot()?.gapTrends.length, 0);
});

test("a sector revision change resets the session cache instead of mixing comparisons", () => {
  let now = 0;
  const service = new RaceIntelligenceService(() => now, 0);
  const first = session(10, [driver(1, 1, 1, 0), driver(2, 1, 2, 1)]);
  first.sectorDefinition = { revision: "r1", source: "iracing", sessionId: first.id, trackName: first.trackName, boundaries: [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: .5 }] };
  for (const at of [10, 13, 16]) { first.timeElapsed = at; now = at * 1_000; service.ingest(first); }
  assert.equal(service.snapshot()?.sectorDefinitionRevision, "r1");
  const revised = structuredClone(first);
  revised.sectorDefinition = { ...first.sectorDefinition, revision: "r2", source: "custom" };
  now = 17_000; revised.timeElapsed = 17; service.ingest(revised);
  assert.equal(service.snapshot()?.sectorDefinitionRevision, "r2");
  assert.ok(service.snapshot()?.gapTrends.every((trend) => trend.quality === "incomplete"));
});

test("does not warn for timing fields that are unavailable by position or lap deficit", () => {
  const service = new RaceIntelligenceService(() => 0, 0);
  service.ingest(session(20, [driver(19, 1, 1, null, {
    lapsBehindLeader: 6,
    timingQuality: {
      gapToLeader: { source: "derived", quality: "incomplete" },
      classIntervalToAhead: { source: "derived", quality: "incomplete" },
      lastLap: { source: "iracing", quality: "incomplete" },
    },
  })]));

  const warnings = service.snapshot()!.qualityWarnings;
  assert.deepEqual(warnings.map((warning) => warning.field), ["lastLap"]);
});
