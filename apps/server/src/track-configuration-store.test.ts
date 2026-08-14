import assert from "node:assert/strict";
import test from "node:test";
import type { SectorBoundary, SessionState, TrackLayoutIdentity } from "@racecontrol/protocol";
import {
  layoutKey,
  MemoryTrackConfigurationRepository,
  MINIMUM_SECTOR_SPACING,
  TrackConfigurationError,
  validateBoundaries,
} from "./track-configuration-store.js";

const layout: TrackLayoutIdentity = { trackId: 101, configurationId: 4, trackName: "Test Circuit", configurationName: "Grand Prix" };
const svg = `<svg viewBox="0 0 100 100"><path id="short" d="M10 10 L90 10 L90 90 L10 90 Z"/><path id="center" d="M0 0 L100 0 L100 100 L0 100 Z"/></svg>`;

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-1", name: "Race", type: "race", trackName: layout.trackName, trackId: layout.trackId ?? null,
    lap: 1, totalLaps: 20, timeRemaining: null, flag: "green", timestamp: new Date().toISOString(), drivers: [],
    lapsCompleted: 0, lapsRemaining: 20, timeElapsed: 0, totalTime: null, phase: "warmup", startState: "set",
    flags: [], classes: [], source: "iracing", sourceMode: "live", externalSubSessionId: null, externalSessionNumber: null,
    ...overrides,
  };
}

async function configured() {
  const repository = new MemoryTrackConfigurationRepository();
  await repository.initialize();
  const map = await repository.importMap({ svg, layout, selectedPathId: "center", originalFilename: "test.svg" });
  const calibration = await repository.saveCalibration({ mapDefinitionId: map.id, startFinishPathPct: 0.2, direction: "reverse", author: "admin" });
  return { repository, map, calibration };
}

test("map imports are checksum-deduplicated per exact layout and calibrations are revisioned", async () => {
  const { repository, map, calibration } = await configured();
  const duplicate = await repository.importMap({ svg, layout, selectedPathId: "short" });
  assert.equal(duplicate.id, map.id);
  const second = await repository.saveCalibration({ mapDefinitionId: map.id, startFinishPathPct: 0.3, direction: "forward" });
  assert.equal(calibration.revision, 1);
  assert.equal(second.revision, 2);
  await repository.activateCalibration(second.id, layout);
  assert.equal((await repository.snapshot(layout)).activeMap?.calibrationRevision, 2);
  await assert.rejects(() => repository.activateCalibration(second.id, { ...layout, configurationId: 5 }), (error: unknown) => error instanceof TrackConfigurationError && error.code === "layout-mismatch");
});

test("draft save is immutable, ordered, resettable to native facts, and activation is singular", async () => {
  const { repository, calibration } = await configured();
  await repository.activateCalibration(calibration.id, layout);
  const nativeBoundaries: SectorBoundary[] = [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: 0.33 }, { sectorNumber: 3, startPct: 0.66 }];
  await repository.observeNativeDefinition(session({ sectorDefinition: { revision: "native-a", source: "iracing", sessionId: "session-1", trackId: 101, trackName: layout.trackName, boundaries: nativeBoundaries } }));
  const draft = await repository.saveSectorDraft({ layout, mapCalibrationId: calibration.id, boundaries: [{ sectorNumber: 9, startPct: 0.7 }, { sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: 0.35 }] });
  assert.equal(draft.source, "custom");
  assert.deepEqual(draft.boundaries.map((boundary) => boundary.sectorNumber), [1, 2, 3]);
  assert.equal((await repository.snapshot(layout)).activeSectorDefinition?.revision, "native-a");
  await repository.activateSectorRevision(draft.revision, layout, session());
  const revisions = await repository.listSectorRevisions(layout);
  assert.equal(revisions.filter((revision) => revision.active).length, 1);
  assert.equal((await repository.snapshot(layout)).activeSectorDefinition?.revision, draft.revision);
  assert.deepEqual(revisions.find((revision) => revision.revision === "native-a")?.boundaries, nativeBoundaries);
});

test("race start locks activation while preserving a future draft", async () => {
  const { repository, calibration } = await configured();
  await repository.observeNativeDefinition(session({ sectorDefinition: { revision: "native-lock", source: "iracing", sessionId: "session-1", trackId: 101, trackName: layout.trackName, boundaries: [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: .5 }] } }));
  const draft = await repository.saveSectorDraft({ layout, mapCalibrationId: calibration.id, boundaries: [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: 0.5 }] });
  await repository.observeNativeDefinition(session({ phase: "racing", startState: "go", lapsCompleted: 1, sectorDefinition: { revision: "native-lock", source: "iracing", sessionId: "session-1", trackId: 101, trackName: layout.trackName, boundaries: [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: .5 }] } }));
  assert.equal((await repository.snapshot(layout)).activeSectorDefinition?.locked, true);
  await assert.rejects(
    () => repository.activateSectorRevision(draft.revision, layout, session({ phase: "racing", startState: "go", lapsCompleted: 1 })),
    (error: unknown) => error instanceof TrackConfigurationError && error.code === "definition-locked",
  );
  assert.equal((await repository.listSectorRevisions(layout)).find((revision) => revision.revision === draft.revision)?.draft, true);
});

test("sector boundary validation enforces start/finish, finite ordering, uniqueness and 0.5% spacing", () => {
  assert.equal(MINIMUM_SECTOR_SPACING, 0.005);
  assert.throws(() => validateBoundaries([{ sectorNumber: 1, startPct: 0.1 }, { sectorNumber: 2, startPct: 0.5 }]), /start\/finish/);
  assert.throws(() => validateBoundaries([{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: Number.NaN }]), /finite/);
  assert.throws(() => validateBoundaries([{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: 0.0049 }]), /0.5%/);
  assert.throws(() => validateBoundaries([{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: 0 }]), /0.5%/);
  assert.notEqual(layoutKey(layout), layoutKey({ ...layout, configurationId: 5 }));
});
