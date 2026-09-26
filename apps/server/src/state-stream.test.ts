import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { WebSocket } from "ws";
import { applyStateChanges, diffState, liveStateFromViewer, receiveViewerState, viewerState,
  type LiveState, type ViewerState, type ViewerStateMessage, type JsonValue } from "@racecontrol/protocol";
import { ViewerStateBroadcaster, MAX_BROADCAST_BUFFER_BYTES, type BroadcastSocket } from "./socket-broadcast.js";
import { StateStore } from "./state-store.js";
import { startSimulator } from "./simulator.js";

class Socket implements BroadcastSocket {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  send(message: string) { this.sent.push(message); }
}

function fixture(): LiveState {
  const state = new StateStore().snapshot();
  const stop = startSimulator({ telemetry(session) {
    state.session = session;
    state.sessionResults[session.type] = session;
  } } as StateStore);
  stop();
  return JSON.parse(JSON.stringify(state));
}

function receive(socket: Socket, current: ViewerState | null = null) {
  return socket.sent.reduce((state, raw) => receiveViewerState(state, JSON.parse(raw) as ViewerStateMessage), current)!;
}

test("field changes reconstruct additions, deletions, nulls, arrays and reordering without mutating the baseline", () => {
  const before: JsonValue = { drivers: [{ id: 1, name: "A", gap: 2 }, { id: 2, name: "B" }], removed: true, config: { old: 1 }, weather: null };
  const original = structuredClone(before);
  const after: JsonValue = { drivers: [{ id: 2, name: "B", gap: null }, { id: 1, name: "A", gap: 3 }], config: {}, weather: { temp: 12 } };
  assert.deepEqual(applyStateChanges(before, diffState(before, after)), after);
  assert.deepEqual(before, original);
  assert.deepEqual(applyStateChanges(after, diffState(after, { drivers: [] })), { drivers: [] });
  assert.throws(() => applyStateChanges({}, [{ path: ["__proto__", "polluted"], value: true }]));
});

test("live changes omit unchanged history and repeated driver identity, with a smaller compressed payload", (t) => {
  const state = fixture();
  const socket = new Socket();
  const stream = new ViewerStateBroadcaster();
  stream.enable(socket);
  stream.broadcast([[socket, "commentator"]], state);
  const initial = receive(socket);
  assert.deepEqual(liveStateFromViewer(initial), state);
  assert.deepEqual((initial.history as { sessionResults: object }).sessionResults, {});
  socket.sent = [];
  const next = structuredClone(state);
  next.revision++;
  next.session!.timeElapsed = (next.session!.timeElapsed ?? 0) + 1;
  next.session!.drivers.forEach((driver, index) => { driver.lapDistPct = (index + 1) / 100; });
  next.sessionResults[next.session!.type] = next.session!;
  stream.broadcast([[socket, "commentator"]], next);
  const delta = JSON.parse(socket.sent[0]) as Extract<ViewerStateMessage, { type: "state.delta" }>;
  assert.equal(delta.type, "state.delta");
  assert.equal(delta.history, undefined);
  assert.ok(!socket.sent[0].includes('"name"'));
  assert.deepEqual(liveStateFromViewer(receive(socket, initial)), next);
  const full = JSON.stringify({ type: "state.snapshot", payload: next });
  const compressedFull = deflateRawSync(full, { level: 3 }).length;
  const compressedDelta = deflateRawSync(socket.sent[0], { level: 3 }).length;
  assert.ok(compressedDelta < compressedFull / 2);
  t.diagnostic(`41-car position update: ${Buffer.byteLength(full)} -> ${Buffer.byteLength(socket.sent[0])} JSON bytes; ${compressedFull} -> ${compressedDelta} compressed bytes`);
});

test("session transitions preserve previous results, update histories and restore current results locally", () => {
  const state = fixture();
  const socket = new Socket();
  const stream = new ViewerStateBroadcaster();
  stream.enable(socket);
  stream.broadcast([[socket, "overlay"]], state);
  const next = structuredClone(state);
  next.revision++;
  next.session = { ...next.session!, id: "next-session", type: "qualifying", drivers: next.session!.drivers.slice(0, 2) };
  next.sessionResults.qualifying = next.session;
  next.events = [];
  stream.broadcast([[socket, "overlay"]], next);
  assert.deepEqual(liveStateFromViewer(receive(socket)), next);
  const restored = liveStateFromViewer(receive(socket));
  assert.equal(restored.sessionResults.race?.id, state.session!.id);
  assert.equal(restored.sessionResults.qualifying, restored.session);
});

test("slow viewers catch up from their own last delivered baseline and reconnect with a full state", () => {
  const state = fixture();
  const slow = new Socket();
  const fast = new Socket();
  const stream = new ViewerStateBroadcaster();
  stream.enable(slow);
  stream.enable(fast);
  const sockets = [[slow, "control"], [fast, "commentator"]] as const;
  stream.broadcast(sockets, state);
  slow.bufferedAmount = MAX_BROADCAST_BUFFER_BYTES + 1;
  const next = structuredClone(state);
  next.revision++;
  next.graphics.selectedDriverCarIdx = 2;
  stream.broadcast(sockets, next);
  assert.equal(slow.sent.length, 1);
  slow.bufferedAmount = 0;
  next.revision++;
  next.graphics.activeSlots = ["timing-tower"];
  stream.broadcast(sockets, next);
  assert.deepEqual(liveStateFromViewer(receive(slow)), next);
  assert.deepEqual(liveStateFromViewer(receive(fast)), next);
  const reconnect = new Socket();
  stream.enable(reconnect);
  stream.broadcast([[reconnect, "control"]], next);
  assert.equal(JSON.parse(reconnect.sent[0]).type, "state.init");
  assert.deepEqual(liveStateFromViewer(receive(reconnect)), next);
  assert.throws(() => receiveViewerState(viewerState(state), {
    type: "state.delta", baseRevision: 999, revision: 1000, live: [],
  }), /out of sync/);
});

test("legacy viewers still receive snapshots and telemetry sockets receive no viewer state", () => {
  const legacy = new Socket();
  const telemetry = new Socket();
  const stream = new ViewerStateBroadcaster();
  stream.broadcast([[legacy, "control"], [telemetry, "telemetry"]], fixture());
  assert.equal(JSON.parse(legacy.sent[0]).type, "state.snapshot");
  assert.equal(telemetry.sent.length, 0);
});
