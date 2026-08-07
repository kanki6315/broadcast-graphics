import assert from "node:assert/strict";
import test from "node:test";
import type { SessionState } from "@racecontrol/protocol";
import { acceptTelemetry } from "./telemetry-ingestion.js";

const session = { id: "test" } as SessionState;

test("accepts telemetry before returning its acknowledgement sequence", () => {
  const calls: string[] = [];
  const sequence = acceptTelemetry(
    { type: "telemetry.update", sequence: 42, payload: session },
    { telemetry: () => calls.push("state") },
    { ingest: () => calls.push("history") },
  );

  assert.deepEqual(calls, ["state", "history"]);
  assert.equal(sequence, 42);
});

test("keeps accepting sequence-less telemetry during the client rollout", () => {
  const sequence = acceptTelemetry(
    { type: "telemetry.update", payload: session },
    { telemetry: () => {} },
    { ingest: () => {} },
  );

  assert.equal(sequence, null);
});

test("rejects invalid sequences before applying telemetry", () => {
  let applied = false;
  assert.throws(() => acceptTelemetry(
    { type: "telemetry.update", sequence: 0, payload: session },
    { telemetry: () => { applied = true; } },
    { ingest: () => {} },
  ), /positive safe integer/);
  assert.equal(applied, false);
});

test("does not accept a sequence when live-state processing fails", () => {
  let historyAccepted = false;
  assert.throws(() => acceptTelemetry(
    { type: "telemetry.update", sequence: 7, payload: session },
    { telemetry: () => { throw new Error("state rejected"); } },
    { ingest: () => { historyAccepted = true; } },
  ), /state rejected/);
  assert.equal(historyAccepted, false);
});
