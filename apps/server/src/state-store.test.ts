import assert from "node:assert/strict";
import test from "node:test";
import type { GraphicPackageManifest, SessionState } from "@racecontrol/protocol";
import { StateStore } from "./state-store.js";

const packages = [{ id: "apex" }] as GraphicPackageManifest[];
const session: SessionState = {
  id: "test",
  name: "Test race",
  type: "race",
  trackName: "Test circuit",
  lap: 1,
  totalLaps: 10,
  timeRemaining: null,
  flag: "green",
  timestamp: new Date().toISOString(),
  lapsCompleted: 0,
  lapsRemaining: 9,
  timeElapsed: 10,
  totalTime: null,
  phase: "racing",
  startState: "go",
  flags: ["green"],
  classes: [{ id: 1, name: "GT3", color: "#ffffff", carCount: 1 }],
  source: "iracing",
  sourceMode: "live",
  externalSubSessionId: 123,
  externalSessionNumber: 0,
  trackId: 45,
  cameraGroups: [{
    number: 3,
    name: "TV 1",
    isScenic: false,
    cameras: [{ number: 0, name: "TV 1" }],
  }],
  activeCameraCarIdx: 7,
  activeCameraGroup: 3,
  activeCamera: 0,
  drivers: [{
    carIdx: 7, position: 1, carNumber: "23", name: "Test Driver", team: "Test Team",
    className: "GT3", interval: null, lastLap: 82, bestLap: 81.5, lapsCompleted: 1,
    onPitRoad: false, incidents: 0,
    classId: 1, classColor: "#ffffff", classPosition: 1, gapToLeader: 0,
    intervalToAhead: null, classGapToLeader: 0, classIntervalToAhead: null,
    lapsBehindLeader: 0, lapsBehindClassLeader: 0, currentLap: 1,
    lastLapNumber: 1, bestLapNumber: 1, lapDistPct: 0.2, trackStatus: "running", isConnected: true,
    userId: 100, teamId: 200, carId: 300, lastLapPosition: 1, lastLapClassPosition: 1,
    lastLapGapToLeader: 0, lastLapGapToClassLeader: 0,
    lastLapLapsBehindLeader: 0, lastLapLapsBehindClassLeader: 0,
  }],
};

test("telemetry establishes a default driver focus", () => {
  const store = new StateStore();
  store.telemetry(session);
  assert.equal(store.snapshot().graphics.selectedDriverCarIdx, 7);
  assert.equal(store.snapshot().connection, "connected");
});

test("taking and clearing a semantic slot updates on-air state", () => {
  const store = new StateStore();
  store.telemetry(session);
  store.command({ type: "graphics.take", slot: "timing-tower" }, packages);
  assert.deepEqual(store.snapshot().graphics.activeSlots, ["timing-tower"]);
  store.command({ type: "graphics.clearAll" }, packages);
  assert.deepEqual(store.snapshot().graphics.activeSlots, []);
});

test("focused-driver and manual camera takes dispatch to the live iRacing controller", () => {
  const store = new StateStore();
  store.setCameraController(true, true);
  store.telemetry(session);

  const focusCommand = store.command({ type: "focus.set", carIdx: 7 }, packages);
  assert.deepEqual(focusCommand && {
    carIdx: focusCommand.carIdx,
    carNumber: focusCommand.carNumber,
    cameraGroup: focusCommand.cameraGroup,
    camera: focusCommand.camera,
  }, { carIdx: 7, carNumber: "23", cameraGroup: 3, camera: 0 });
  assert.equal(store.snapshot().camera.pendingCommandId, focusCommand?.id);

  store.cameraResult(focusCommand!.id, "sent", "Camera sent — #23 / group 3");
  assert.equal(store.snapshot().camera.lastResult, "sent");
  assert.equal(store.snapshot().camera.pendingCommandId, null);

  const takeCommand = store.command({ type: "camera.take" }, packages);
  assert.equal(takeCommand?.cameraGroup, 3);
});

test("camera takes remain unavailable without a live camera-capable telemetry source", () => {
  const store = new StateStore();
  store.telemetry(session);
  const cameraCommand = store.command({ type: "camera.take" }, packages);
  assert.equal(cameraCommand, null);
  assert.equal(store.snapshot().camera.lastResult, "rejected");
});
