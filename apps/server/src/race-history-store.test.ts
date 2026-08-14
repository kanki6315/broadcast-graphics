import assert from "node:assert/strict";
import test from "node:test";
import type { DriverState, SessionState } from "@racecontrol/protocol";
import { MemoryRaceHistoryRepository, RaceHistoryService } from "./race-history-store.js";

function driver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    carIdx: 7,
    position: 2,
    carNumber: "23",
    name: "Test Driver",
    team: "Test Team",
    className: "GT3",
    interval: 1.2682,
    lastLap: 97.3093,
    bestLap: 97.3093,
    lapsCompleted: 1,
    onPitRoad: false,
    incidents: 0,
    classId: 1,
    classColor: "#ffffff",
    classPosition: 2,
    gapToLeader: 1.2682,
    intervalToAhead: 1.2682,
    classGapToLeader: 1.2682,
    classIntervalToAhead: 1.2682,
    lapsBehindLeader: 0,
    lapsBehindClassLeader: 0,
    currentLap: 2,
    lastLapNumber: 1,
    bestLapNumber: 1,
    lapDistPct: 0.02,
    trackStatus: "running",
    isConnected: true,
    userId: 100,
    teamId: 200,
    carId: 300,
    lastLapPosition: 2,
    lastLapClassPosition: 2,
    lastLapGapToLeader: 1.2682,
    lastLapGapToClassLeader: 1.2682,
    lastLapLapsBehindLeader: 0,
    lastLapLapsBehindClassLeader: 0,
    ...overrides,
  };
}

function session(driverState = driver(), overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "87765685-2",
    name: "Race",
    type: "race",
    trackName: "Long Beach",
    lap: 2,
    totalLaps: null,
    timeRemaining: 1_400,
    flag: "green",
    timestamp: "2026-08-06T21:47:27.253Z",
    drivers: [driverState],
    lapsCompleted: 1,
    lapsRemaining: null,
    timeElapsed: 100,
    totalTime: 1_500,
    phase: "racing",
    startState: "go",
    flags: ["green"],
    classes: [{ id: 1, name: "GT3", color: "#ffffff", carCount: 1 }],
    source: "iracing",
    sourceMode: "live",
    externalSubSessionId: 87_765_685,
    externalSessionNumber: 2,
    trackId: 168,
    ...overrides,
  };
}

test("records a completed lap once with its scoring-line gap", async () => {
  const repository = new MemoryRaceHistoryRepository();
  const emitted: number[] = [];
  const history = new RaceHistoryService(repository, (lap) => emitted.push(lap.lapNumber));
  const update = session();

  history.ingest(update);
  history.ingest(update);
  const laps = await history.listLaps(update, 7);

  assert.equal(laps.length, 1);
  assert.equal(laps[0]?.lapNumber, 1);
  assert.equal(laps[0]?.lapTime, 97.3093);
  assert.equal(laps[0]?.gapToLeader, 1.2682);
  assert.equal(laps[0]?.position, 2);
  assert.equal(laps[0]?.personalBest, true);
  assert.deepEqual(emitted, [1]);
  await history.close();
});

test("records later laps and keeps replay history separate from live history", async () => {
  const repository = new MemoryRaceHistoryRepository();
  const history = new RaceHistoryService(repository);
  const first = session();
  const secondDriver = driver({
    lastLap: 93.7461,
    bestLap: 93.7461,
    lapsCompleted: 2,
    currentLap: 3,
    lastLapNumber: 2,
    bestLapNumber: 2,
    lastLapGapToLeader: 2.638,
  });
  const second = session(secondDriver, { lap: 3, lapsCompleted: 2, timeElapsed: 194 });

  history.ingest(first);
  history.ingest(second);
  history.ingest(session(secondDriver, { ...second, sourceMode: "replay" }));

  assert.deepEqual((await history.listLaps(second, 7)).map((lap) => lap.lapNumber), [1, 2]);
  const replay = session(secondDriver, { ...second, sourceMode: "replay" });
  assert.deepEqual((await history.listLaps(replay, 7)).map((lap) => lap.lapNumber), [2]);
  await history.close();
});

test("waits for the matching scoring result before recording a race lap", async () => {
  const repository = new MemoryRaceHistoryRepository();
  const history = new RaceHistoryService(repository);
  const unmatched = session(driver({
    lastLapPosition: null,
    lastLapClassPosition: null,
    lastLapGapToLeader: null,
    lastLapLapsBehindLeader: null,
  }));

  history.ingest(unmatched);
  assert.deepEqual(await history.listLaps(unmatched, 7), []);
  await history.close();
});

test("records a lapped car without inventing a seconds gap", async () => {
  const repository = new MemoryRaceHistoryRepository();
  const history = new RaceHistoryService(repository);
  const update = session(driver({
    lastLapGapToLeader: null,
    lastLapGapToClassLeader: null,
    lastLapLapsBehindLeader: 1,
    lastLapLapsBehindClassLeader: 1,
  }));

  history.ingest(update);
  const lap = (await history.listLaps(update, 7))[0];
  assert.equal(lap?.gapToLeader, null);
  assert.equal(lap?.lapsBehindLeader, 1);
  await history.close();
});

test("persists semantic sectors idempotently and isolates definition revisions", async () => {
  const repository = new MemoryRaceHistoryRepository();
  const history = new RaceHistoryService(repository);
  const definition = {
    revision: "iracing-a", source: "iracing" as const, sessionId: "87765685-2", trackId: 168,
    trackName: "Long Beach", boundaries: [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: .5 }],
  };
  const sector = {
    carIdx: 7, lapNumber: 1, sectorNumber: 1, definitionRevision: definition.revision,
    source: "derived" as const, quality: "valid" as const, value: 48.2, completedAt: 50,
    driverId: "99", driverName: "Previous Driver",
  };
  const update = session(driver({ sectors: { currentSectorNumber: 2, currentLap: [], previousLap: [sector] } }), {
    sectorDefinition: definition,
  });

  history.ingest(update);
  history.ingest(update);
  const persisted = await history.listSectors(update, 7);
  assert.deepEqual(persisted.map((result) => result.value), [48.2]);
  assert.equal(persisted[0]?.driverName, "Previous Driver");

  const revised = { ...definition, revision: "iracing-b" };
  const revisedSector = { ...sector, definitionRevision: revised.revision, value: 48.1 };
  const revisedUpdate = session(driver({ sectors: { currentSectorNumber: 2, currentLap: [], previousLap: [revisedSector] } }), {
    sectorDefinition: revised,
  });
  history.ingest(revisedUpdate);
  assert.equal((await history.listSectors(revisedUpdate, 7)).length, 2);
  await history.close();
});
