import assert from "node:assert/strict";
import test from "node:test";
import type { ClassGapHistoryResponse } from "@racecontrol/protocol";
import { mergeClassGapHistory } from "./use-gap-history";

function history(points: ClassGapHistoryResponse["points"]): ClassGapHistoryResponse {
  return {
    sessionId: "race-1",
    classId: 4,
    drivers: [{ carIdx: 7, carNumber: "23", name: "Driver", team: "Team", classId: 4, className: "GT3", classColor: "#ff4b21" }],
    points,
  };
}

test("class history cache merges incremental laps and replaces duplicate points", () => {
  const cached = history([
    { carIdx: 7, lapNumber: 1, classPosition: 2, gapToClassLeader: 1.2, lapsBehindClassLeader: 0 },
    { carIdx: 7, lapNumber: 2, classPosition: 2, gapToClassLeader: 1.4, lapsBehindClassLeader: 0 },
  ]);
  const incoming = history([
    { carIdx: 7, lapNumber: 2, classPosition: 2, gapToClassLeader: 1.35, lapsBehindClassLeader: 0 },
    { carIdx: 7, lapNumber: 3, classPosition: 2, gapToClassLeader: 1.1, lapsBehindClassLeader: 0 },
  ]);

  const merged = mergeClassGapHistory(cached, incoming);
  assert.deepEqual(merged.points.map((point) => [point.lapNumber, point.gapToClassLeader]), [[1, 1.2], [2, 1.35], [3, 1.1]]);
});

test("class history cache never merges different sessions", () => {
  const cached = history([{ carIdx: 7, lapNumber: 1, classPosition: 2, gapToClassLeader: 1.2, lapsBehindClassLeader: 0 }]);
  const incoming = { ...history([{ carIdx: 7, lapNumber: 8, classPosition: 1, gapToClassLeader: 0, lapsBehindClassLeader: 0 }]), sessionId: "race-2" };
  assert.deepEqual(mergeClassGapHistory(cached, incoming), incoming);
});
