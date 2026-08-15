import assert from "node:assert/strict";
import test from "node:test";
import type { ClassGapHistoryPoint } from "@racecontrol/protocol";
import { downsampleGapPoints } from "./gap-visualizer";

test("chart downsampling bounds path complexity and preserves missing-history breaks", () => {
  const points: ClassGapHistoryPoint[] = Array.from({ length: 5_000 }, (_, index) => ({
    carIdx: 7,
    lapNumber: index + 1,
    classPosition: 2,
    gapToClassLeader: index === 2_500 ? null : index / 100,
    lapsBehindClassLeader: index === 2_500 ? 1 : 0,
  }));
  const sampled = downsampleGapPoints(points, 500);
  assert.ok(sampled.length <= 504);
  assert.equal(sampled[0]?.lapNumber, 1);
  assert.equal(sampled.at(-1)?.lapNumber, 5_000);
  assert.ok(sampled.some((point) => point.lapNumber === 2_501 && point.gapToClassLeader == null));
  assert.ok(sampled.some((point) => point.lapNumber === 2_502 && point.gapToClassLeader != null));
});
