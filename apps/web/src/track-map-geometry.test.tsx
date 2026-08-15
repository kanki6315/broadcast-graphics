import assert from "node:assert/strict";
import test from "node:test";
import { lapPctToPathPct, pathPctToLapPct, pointAndHeadingForLapPct, pointForLapPct, projectToPath, type PathLengthReader } from "./track-map-geometry";

const forward = { startFinishPathPct: 0.25, direction: "forward" as const };
const reverse = { startFinishPathPct: 0.25, direction: "reverse" as const };
const line: PathLengthReader = {
  getTotalLength: () => 100,
  getPointAtLength: (distance) => ({ x: distance, y: 0 }),
};

test("browser geometry applies start offset, direction and inverse mapping", () => {
  assert.ok(Math.abs(lapPctToPathPct(.9, forward) - .15) < 1e-12);
  assert.ok(Math.abs(lapPctToPathPct(.1, reverse) - .15) < 1e-12);
  assert.ok(Math.abs(pathPctToLapPct(.15, reverse) - .1) < 1e-12);
  assert.deepEqual(pointForLapPct(line, .25, forward), { x: 50, y: 0 });
});

test("browser geometry exposes the selected travel heading", () => {
  assert.equal(pointAndHeadingForLapPct(line, .5, { startFinishPathPct: 0, direction: "forward" }).angleDegrees, 0);
  assert.equal(pointAndHeadingForLapPct(line, .5, { startFinishPathPct: 0, direction: "reverse" }).angleDegrees, 180);
});

test("browser geometry projects view-box points back to calibrated lap percentage", () => {
  const result = projectToPath(line, { x: 60, y: 12 }, forward);
  assert.ok(Math.abs(result.point.x - 60) < .1);
  assert.ok(Math.abs(result.pathPct - .6) < .001);
  assert.ok(Math.abs(result.lapPct - .35) < .001);
});

test("browser geometry rejects an unusable centerline", () => {
  assert.throws(() => pointForLapPct({ ...line, getTotalLength: () => 0 }, .2, forward), /could not be measured/);
  assert.throws(() => projectToPath(line, { x: Number.NaN, y: 0 }, forward), /cannot be projected/);
});
