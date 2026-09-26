import assert from "node:assert/strict";
import test from "node:test";
import type { ClassGapHistoryPoint } from "@racecontrol/protocol";
import { comparisonValue } from "./car-comparison";
const point: ClassGapHistoryPoint = { carIdx: 1, lapNumber: 12, classPosition: 3, gapToClassLeader: 10, lapsBehindClassLeader: 0, lapTime: 82 };
const rival: ClassGapHistoryPoint = { ...point, carIdx: 2, classPosition: 2, gapToClassLeader: 7, lapTime: 83 };
test("comparison distinguishes relative scoring gap from lap-time difference", () => {
  assert.equal(comparisonValue(point, rival, "gap"), 3);
  assert.equal(comparisonValue(point, rival, "pace"), -1);
});
test("unobserved and lapped gaps do not become invented numeric comparisons", () => {
  assert.equal(comparisonValue(point, undefined, "gap"), null);
  assert.equal(comparisonValue({ ...point, lapsBehindClassLeader: 1 }, rival, "gap"), null);
  assert.equal(comparisonValue(point, { ...rival, gapToClassLeader: null }, "gap"), null);
  assert.equal(comparisonValue(point, { ...rival, lapTime: undefined }, "pace"), null);
});
