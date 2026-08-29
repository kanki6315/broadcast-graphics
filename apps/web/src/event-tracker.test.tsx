import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RaceEvent } from "@racecontrol/protocol";
import { EventTracker } from "./event-tracker";

const events: RaceEvent[] = [{
  id: "race:1", sessionId: "race", at: "2026-01-01T00:02:05.000Z", sessionTime: 125, lap: 4,
  kind: "pass", confidence: "likely", primaryCarIdx: 7, secondaryCarIdx: 8, classId: 1,
  summary: "#7 passed #8", detail: "Driver 7 moved into 2nd in GT3",
}, {
  id: "race:2", sessionId: "race", at: "2026-01-01T00:02:10.000Z", sessionTime: 130, lap: 4,
  kind: "crash", confidence: "possible", primaryCarIdx: 12, classId: 2,
  summary: "Possible crash · #12", detail: "Driver 12 · off track · 2 class positions lost",
}];

test("event tracker presents evidence and class-filtered counts", () => {
  const allMarkup = renderToStaticMarkup(<EventTracker events={events} classId="all" />);
  assert.match(allMarkup, /#7 passed #8/);
  assert.match(allMarkup, /Possible crash/);
  assert.match(allMarkup, /L4 · 2:05/);

  const classMarkup = renderToStaticMarkup(<EventTracker events={events} classId={1} />);
  assert.match(classMarkup, /#7 passed #8/);
  assert.doesNotMatch(classMarkup, /Possible crash/);
});

test("compact tracker retains the full event history for scrolling and exposes the full log", () => {
  const overflowEvents = [
    ...events,
    { ...events[0]!, id: "race:3", summary: "Older pass three" },
    { ...events[0]!, id: "race:4", summary: "Older pass four" },
  ];
  const markup = renderToStaticMarkup(<EventTracker events={overflowEvents} classId="all" />);
  assert.match(markup, /Older pass three/);
  assert.match(markup, /Older pass four/);
  assert.match(markup, /aria-label="Open full event log"/);
  assert.match(markup, /aria-expanded="false"/);
});

test("event tracker explains its empty heuristic state", () => {
  const markup = renderToStaticMarkup(<EventTracker events={[]} classId="all" />);
  assert.match(markup, /No inferred events/);
  assert.match(markup, /position swaps, surface departures, and stalled progress/);
});
