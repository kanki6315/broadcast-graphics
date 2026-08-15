import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DriverState, RaceIntelligenceSnapshot } from "@racecontrol/protocol";
import { CommentatorTimingTable, defaultCommentatorColumns, sortByClassPosition, sortByOverallPosition, type CommentatorColumn } from "./timing-table";
import { BattleWatch } from "./battle-watch";

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
    expandedCarIdxs={new Set()}
    visibleColumns={new Set([...defaultCommentatorColumns, "lap"])}
    groupByClass={false}
    onToggleExpanded={() => {}}
  />);
}

test("missing optional commentator timing renders as double hyphens", () => {
  const markup = render(driver());
  assert.match(markup, /Quality not reported[^>]*>--</);
  assert.match(markup, /position-change is-unknown[^>]*>--</);
  assert.match(markup, /producer does not report pit summaries[^>]*>--</);
  assert.match(markup, /class="position-cell" aria-expanded="false" title="Show timing detail"/);
  assert.doesNotMatch(markup, /expand-control/);
  assert.doesNotMatch(markup, /is-selected|aria-current|Follow Driver/);
  assert.doesNotMatch(markup, />—</);
});

test("all-class timing orders cars by overall position", () => {
  const drivers = [
    driver({ carIdx: 1, className: "Ford GT", classPosition: 2, position: 21 }),
    driver({ carIdx: 2, className: "GT1", classPosition: 1, position: 13 }),
    driver({ carIdx: 3, className: "HPD", classPosition: 2, position: 2 }),
    driver({ carIdx: 4, className: "HPD", classPosition: 1, position: 1 }),
    driver({ carIdx: 5, className: "Ford GT", classPosition: 1, position: 20 }),
  ];

  assert.deepEqual(sortByOverallPosition(drivers).map((candidate) => candidate.carIdx), [4, 3, 2, 5, 1]);
  assert.deepEqual(sortByClassPosition(drivers).map((candidate) => candidate.carIdx), [4, 2, 5, 3, 1]);
  assert.deepEqual(drivers.map((candidate) => candidate.carIdx), [1, 2, 3, 4, 5]);
});

test("class gaps replace overall gaps and disappear for single-class races", () => {
  const current = driver({
    classGapToLeader: 1.25,
    classIntervalToAhead: .5,
    timingQuality: {
      classGapToLeader: { source: "derived", quality: "valid" },
      classIntervalToAhead: { source: "derived", quality: "valid" },
    },
  });
  const columns = new Set<CommentatorColumn>(["gap", "interval"]);
  const multiClassMarkup = renderToStaticMarkup(<CommentatorTimingTable
    drivers={[current]} expandedCarIdxs={new Set()}
    visibleColumns={columns} groupByClass={false} showClassGaps onToggleExpanded={() => {}}
  />);
  assert.match(multiClassMarkup, /Class gap/);
  assert.match(multiClassMarkup, /Class interval/);
  assert.doesNotMatch(multiClassMarkup, /overall/i);

  const singleClassMarkup = renderToStaticMarkup(<CommentatorTimingTable
    drivers={[current]} expandedCarIdxs={new Set()}
    visibleColumns={columns} groupByClass={false} showClassGaps={false} onToggleExpanded={() => {}}
  />);
  assert.doesNotMatch(singleClassMarkup, /Class gap|Class interval/);
});

test("current, previous, and best sectors share the timing row", () => {
  const sector = (lapNumber: number, sectorNumber: number, value: number) => ({
    carIdx: 7, lapNumber, sectorNumber, value, definitionRevision: "r1", source: "derived" as const, quality: "valid" as const,
  });
  const markup = render(driver({
    sectors: {
      currentSectorNumber: 2,
      currentLap: [sector(5, 1, 30.1)],
      previousLap: [sector(4, 1, 30.3), sector(4, 2, 31.4)],
      bestSectors: [sector(2, 1, 29.9), sector(3, 2, 31.1)],
    },
  }));
  assert.match(markup, /Current/);
  assert.match(markup, /Previous/);
  assert.match(markup, /Best/);
  assert.match(markup, /30\.100/);
  assert.match(markup, /31\.400/);
  assert.match(markup, /29\.900/);
});

test("pit summary preserves tracker totals and marks only inferred box time", () => {
  const current = driver({
    latestPitVisit: {
      pitEntryTime: 100, pitExitTime: 128, pitLaneTime: 9, boxTime: 19, unknownTime: 0,
      observedBoxTime: 9, inferredBoxTime: 10, driverChange: true,
      entryDriverId: "41", exitDriverId: "42", quality: "contains-inference",
    },
  });
  const markup = renderToStaticMarkup(<CommentatorTimingTable
    drivers={[current]} expandedCarIdxs={new Set([7])}
    visibleColumns={new Set(defaultCommentatorColumns)} groupByClass={false} onToggleExpanded={() => {}}
    pitStops={[
      { carIdx: 7, pitLap: 5, pitEntryTime: 100, pitExitTime: 128, pitLaneTime: 9, boxTime: 19, unknownTime: 0, observedBoxTime: 9, inferredBoxTime: 10, driverChange: true, entryDriverId: "41", entryDriverName: "Driver One", exitDriverId: "42", exitDriverName: "Driver Two", quality: "inferred" },
      { carIdx: 7, pitLap: 2, pitEntryTime: 40, pitExitTime: 58, pitLaneTime: 8, boxTime: 10, unknownTime: 0, observedBoxTime: 10, inferredBoxTime: 0, driverChange: false, quality: "valid" },
    ]}
  />);
  assert.match(markup, /Lane<\/small>9\.000s/);
  assert.match(markup, /contains-inference[^>]*><small>Box<\/small>~19\.000s/);
  assert.match(markup, /Lap<\/small>L5/);
  assert.match(markup, /Unknown<\/small>0\.000s/);
  assert.match(markup, /pit-driver-change/);
  assert.match(markup, /aria-label="Driver change"/);
  assert.doesNotMatch(markup, /<small>Lane<\/small>~/);
  assert.match(markup, /Race pit-stop history/);
  assert.match(markup, /Stationary/);
  assert.match(markup, /Driver Two/);
  assert.match(markup, /from Driver One/);
  assert.match(markup, /L2/);
});

test("dirty and inferred sectors never receive fastest styling", () => {
  const markup = render(driver({
    sectors: {
      currentSectorNumber: 2,
      currentLap: [],
      previousLap: [
        { carIdx: 7, lapNumber: 4, sectorNumber: 1, definitionRevision: "r1", source: "derived", quality: "invalid", reason: "telemetry-gap", comparisons: ["overall-fastest"] },
        { carIdx: 7, lapNumber: 4, sectorNumber: 2, definitionRevision: "r1", source: "derived", quality: "inferred", value: 31.2, comparisons: ["overall-fastest"] },
      ],
    },
  }));
  assert.match(markup, /telemetry gap[^>]*><small>S1<\/small>--/);
  assert.match(markup, /inferred[^>]*><small>S2<\/small>~31\.200/);
  assert.doesNotMatch(markup, /is-overall-fastest/);
});

test("stint context is presented from the canonical intelligence snapshot", () => {
  const current = driver();
  const markup = renderToStaticMarkup(<CommentatorTimingTable
    drivers={[current]} expandedCarIdxs={new Set([7])}
    visibleColumns={new Set(defaultCommentatorColumns)} groupByClass={false} onToggleExpanded={() => {}}
    stints={[{ carIdx: 7, currentDriverId: "41", currentDriverName: "Driver", previousDriverName: "Previous Driver", startedAt: 100, duration: 372, lapCount: 5, changeContext: "inferred-box", quality: "inferred" }]}
  />);
  assert.match(markup, /~6:12/);
  assert.match(markup, /title="5 laps · from Previous Driver/);
  assert.match(markup, /<small>5 laps<\/small>/);
  assert.match(markup, /inferred-box · inferred/);
});

test("expanded confidence omits positionally unavailable leader timing", () => {
  const current = driver({
    position: 20,
    classPosition: 1,
    lapsBehindLeader: 6,
    timingQuality: {
      gapToLeader: { source: "derived", quality: "incomplete" },
      classIntervalToAhead: { source: "derived", quality: "incomplete" },
      lastLap: { source: "iracing", quality: "incomplete" },
    },
  });
  const markup = renderToStaticMarkup(<CommentatorTimingTable
    drivers={[current]} expandedCarIdxs={new Set([7])}
    visibleColumns={new Set(defaultCommentatorColumns)} groupByClass={false} onToggleExpanded={() => {}}
  />);

  assert.doesNotMatch(markup, /gapToLeader: incomplete/);
  assert.doesNotMatch(markup, /classIntervalToAhead: incomplete/);
  assert.match(markup, /lastLap: incomplete/);
});

test("Battle Watch filters shared candidates by class and contains no control commands", () => {
  const drivers = [driver({ carIdx: 1, carNumber: "1", classId: 1 }), driver({ carIdx: 2, carNumber: "2", classId: 1 }), driver({ carIdx: 3, carNumber: "3", classId: 2 }), driver({ carIdx: 4, carNumber: "4", classId: 2 })];
  const intelligence: RaceIntelligenceSnapshot = {
    sessionId: "race", generatedAt: 1,
    battles: [
      { id: "gt", classId: 1, className: "GT3", carIdxs: [1, 2], currentGap: 1.2, lapDeficit: 0, windowSeconds: 12, direction: "closing", quality: "valid" },
      { id: "tcr", classId: 2, className: "TCR", carIdxs: [3, 4], currentGap: .8, lapDeficit: 0, windowSeconds: 12, direction: "opening", quality: "valid" },
    ], gapTrends: [], pitCycles: [], pitStops: [], stints: [], qualityWarnings: [],
  };
  const markup = renderToStaticMarkup(<BattleWatch intelligence={intelligence} drivers={drivers} classId={2} selectedCarIdx={3} />);
  assert.match(markup, /#3/);
  assert.match(markup, /#4/);
  assert.doesNotMatch(markup, /#1/);
  assert.doesNotMatch(markup, /<button|is-selected/);
  assert.doesNotMatch(markup, /camera\.command|control\.command|graphics\./);
});
