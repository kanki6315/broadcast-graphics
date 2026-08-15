import assert from "node:assert/strict";
import test from "node:test";
import type { DriverState, SessionState } from "@racecontrol/protocol";
import {
  MemoryRaceIntelligenceCheckpointRepository,
  RaceIntelligencePersistence,
} from "./race-intelligence-persistence.js";
import { RaceIntelligenceService } from "./race-intelligence-service.js";
import { StateStore } from "./state-store.js";

function session(at: number, lapsCompleted: number, position = 4): SessionState {
  const driver: DriverState = {
    carIdx: 7, position, carNumber: "23", name: "Driver", team: "Team", className: "GT3",
    interval: 0, lastLap: 82, bestLap: 81, lapsCompleted, onPitRoad: false, incidents: 0,
    classId: 1, classColor: "#fff", classPosition: position, gapToLeader: 0, intervalToAhead: 0,
    classGapToLeader: 0, classIntervalToAhead: 0, lapsBehindLeader: 0, lapsBehindClassLeader: 0,
    currentLap: lapsCompleted + 1, lastLapNumber: lapsCompleted, bestLapNumber: 1, lapDistPct: .2,
    trackStatus: "running", pitState: "not-in-pits", latestPitVisit: null, isConnected: true,
    userId: 41, teamId: 42, carId: 43, lastLapPosition: position, lastLapClassPosition: position,
    lastLapGapToLeader: 0, lastLapGapToClassLeader: 0, lastLapLapsBehindLeader: 0,
    lastLapLapsBehindClassLeader: 0, startingPosition: 4, startingClassPosition: 4,
  };
  return {
    id: "race", name: "Race", type: "race", trackName: "Track", lap: lapsCompleted + 1,
    totalLaps: 20, timeRemaining: null, flag: "green", timestamp: new Date(at * 1000).toISOString(),
    drivers: [driver], lapsCompleted, lapsRemaining: 20 - lapsCompleted, timeElapsed: at,
    totalTime: null, phase: "racing", startState: "go", flags: ["green"],
    classes: [{ id: 1, name: "GT3", color: "#fff", carCount: 1 }], source: "iracing",
    sourceMode: "live", externalSubSessionId: 1, externalSessionNumber: 0, trackId: 2,
  };
}

test("hydrates a restarted service from one bounded session checkpoint", async () => {
  const repository = new MemoryRaceIntelligenceCheckpointRepository();
  await repository.initialize();
  const firstIntelligence = new RaceIntelligenceService(() => 100_000, 0);
  const firstStore = new StateStore();
  const firstPersistence = new RaceIntelligencePersistence(repository, firstIntelligence, firstStore);
  const initial = session(100, 10);
  await firstPersistence.hydrate(initial);
  firstIntelligence.ingest(initial);
  firstStore.telemetry(initial);
  firstPersistence.observe(initial);
  await firstPersistence.close();

  const restoredIntelligence = new RaceIntelligenceService(() => 130_000, 0);
  const restoredStore = new StateStore();
  const restoredPersistence = new RaceIntelligencePersistence(repository, restoredIntelligence, restoredStore);
  const resumed = session(130, 12, 2);
  await restoredPersistence.hydrate(resumed);
  restoredIntelligence.ingest(resumed);
  restoredStore.telemetry(resumed);

  assert.equal(restoredIntelligence.snapshot()?.stints[0]?.duration, 30);
  assert.equal(restoredIntelligence.snapshot()?.stints[0]?.lapCount, 2);
  assert.equal(restoredStore.snapshot().session?.drivers[0]?.startingPosition, 4);
  assert.equal(restoredStore.snapshot().session?.drivers[0]?.positionChange, 2);
  await restoredPersistence.close();
});
