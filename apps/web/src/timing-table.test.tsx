import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DriverState } from "@racecontrol/protocol";
import { CommentatorTimingTable, defaultCommentatorColumns } from "./timing-table";

function driver(overrides: Partial<DriverState> = {}): DriverState {
  return {
    carIdx: 7, position: 2, carNumber: "23", name: "Driver", team: "Team", className: "GT3",
    interval: null, lastLap: null, bestLap: null, lapsCompleted: 4, onPitRoad: false, incidents: 0,
    classId: 1, classColor: "#ff4b21", classPosition: 2, gapToLeader: null, intervalToAhead: null,
    classGapToLeader: null, classIntervalToAhead: null, lapsBehindLeader: 0, lapsBehindClassLeader: 0,
    currentLap: 5, lastLapNumber: null, bestLapNumber: null, lapDistPct: null, trackStatus: "running",
    isConnected: true, userId: 41, teamId: 42, carId: 43, lastLapPosition: null,
    lastLapClassPosition: null, lastLapGapToLeader: null, lastLapGapToClassLeader: null,
    lastLapLapsBehindLeader: null, lastLapLapsBehindClassLeader: null,
    ...overrides,
  };
}

function render(current: DriverState): string {
  return renderToStaticMarkup(<CommentatorTimingTable
    drivers={[current]}
    selectedCarIdx={current.carIdx}
    nearbyCarIdxs={new Set()}
    expandedCarIdxs={new Set()}
    visibleColumns={new Set([...defaultCommentatorColumns, "lap"])}
    groupByClass={false}
    onSelectCar={() => {}}
    onToggleExpanded={() => {}}
  />);
}

test("missing optional commentator timing renders as double hyphens", () => {
  const markup = render(driver());
  assert.match(markup, /Quality not reported[^>]*>--</);
  assert.match(markup, /position-change is-unknown[^>]*>--</);
  assert.match(markup, /producer does not report pit summaries[^>]*>--</);
  assert.doesNotMatch(markup, />—</);
});

test("pit summary preserves tracker totals and marks only inferred box time", () => {
  const markup = render(driver({
    latestPitVisit: {
      pitEntryTime: 100, pitExitTime: 128, pitLaneTime: 9, boxTime: 19, unknownTime: 0,
      observedBoxTime: 9, inferredBoxTime: 10, driverChange: true,
      entryDriverId: "41", exitDriverId: "42", quality: "contains-inference",
    },
  }));
  assert.match(markup, /Lane<\/small>9\.000s/);
  assert.match(markup, /contains-inference[^>]*><small>Box<\/small>~19\.000s/);
  assert.match(markup, /Unknown<\/small>0\.000s/);
  assert.match(markup, /Driver change/);
  assert.doesNotMatch(markup, /<small>Lane<\/small>~/);
});
