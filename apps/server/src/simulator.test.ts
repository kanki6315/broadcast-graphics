import assert from "node:assert/strict";
import test from "node:test";
import { simulatedDrivers } from "./simulator.js";

test("simulator includes multiclass baselines and both inferred and unknown pit gaps", () => {
  const missing = simulatedDrivers(9);
  const inferredReturn = simulatedDrivers(10);
  const completedUnknown = simulatedDrivers(7);

  assert.equal(missing.length, 41);
  assert.deepEqual(new Set(missing.map((driver) => driver.classId)), new Set([1, 2]));
  assert.equal(missing.every((driver) => driver.startingPosition != null), true);

  const inferredCarMissing = missing.find((driver) => driver.carIdx === 9)!;
  const inferredCarReturned = inferredReturn.find((driver) => driver.carIdx === 9)!;
  assert.equal(inferredCarMissing.pitState, "unobserved");
  assert.equal(inferredCarMissing.latestPitVisit?.unknownTime, 3);
  assert.equal(inferredCarReturned.pitState, "pit-stall");
  assert.equal(inferredCarReturned.latestPitVisit?.inferredBoxTime, 4);
  assert.equal(inferredCarReturned.latestPitVisit?.unknownTime, 0);

  const unknownCar = completedUnknown.find((driver) => driver.carIdx === 8)!;
  assert.equal(unknownCar.latestPitVisit?.inferredBoxTime, 0);
  assert.equal(unknownCar.latestPitVisit?.unknownTime, 4);
  assert.equal(missing.some((driver) => driver.sectors?.previousLap?.some((sector) => sector.quality === "invalid")), true);
});
