import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompletedSessionReview } from "@racecontrol/protocol";
import { SessionReview } from "./session-review";

const review: CompletedSessionReview = {
  session: {
    id: "history-qualifying",
    sourceSessionId: "87765685-1",
    source: "iracing",
    sourceMode: "live",
    externalSubSessionId: 87_765_685,
    externalSessionNumber: 1,
    name: "Qualifying",
    type: "qualifying",
    trackId: 168,
    trackName: "Long Beach",
    firstSeenAt: "2026-08-06T21:00:00.000Z",
    lastSeenAt: "2026-08-06T21:10:00.000Z",
    completedAt: "2026-08-06T21:10:00.000Z",
    resultCount: 1,
    sectorCount: 3,
  },
  classes: [{ id: 1, name: "GT3", color: "#ffffff", carCount: 1 }],
  sectorDefinitions: [{
    revision: "r1", source: "iracing", sessionId: "87765685-1", trackName: "Long Beach",
    boundaries: [{ sectorNumber: 1, startPct: 0 }, { sectorNumber: 2, startPct: .5 }],
  }],
  sectorRevision: "r1",
  results: [{
    carIdx: 7, position: 1, classPosition: 1, carNumber: "23", name: "Test Driver", team: "Test Team",
    classId: 1, className: "GT3", classColor: "#ffffff", lapsCompleted: 5, lastLap: 96.2, bestLap: 95.8,
    gapToLeader: 0, classGapToLeader: 0, lapsBehindLeader: 0, lapsBehindClassLeader: 0, trackStatus: "running",
    bestSectors: [{ carIdx: 7, lapNumber: 4, sectorNumber: 1, definitionRevision: "r1", source: "derived", quality: "valid", value: 47.7 }],
  }],
};

test("completed-session review shows classifications, best sectors, and revision context", () => {
  const markup = renderToStaticMarkup(<SessionReview review={review} loading={false} error="" classId="all" onRevisionChange={() => {}} />);
  assert.match(markup, /Qualifying results/);
  assert.match(markup, /Test Driver/);
  assert.match(markup, /47\.700/);
  assert.match(markup, /iracing · r1/);
});

test("completed-session review has explicit loading and error states", () => {
  assert.match(renderToStaticMarkup(<SessionReview review={null} loading error="" classId="all" onRevisionChange={() => {}} />), /Loading completed session/);
  assert.match(renderToStaticMarkup(<SessionReview review={null} loading={false} error="Database unavailable" classId="all" onRevisionChange={() => {}} />), /Database unavailable/);
});
