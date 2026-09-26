import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerMessage } from "@racecontrol/protocol";
import { broadcastStateSnapshot, MAX_BROADCAST_BUFFER_BYTES, SNAPSHOT_COMPRESSION, type BroadcastSocket, type SocketRole } from "./socket-broadcast.js";
import { StateStore } from "./state-store.js";
import { startSimulator } from "./simulator.js";

class RecordingSocket implements BroadcastSocket {
  readonly sent: string[] = [];

  constructor(public readonly readyState: number = WebSocket.OPEN, public readonly bufferedAmount = 0) {}

  send(data: string): void {
    this.sent.push(data);
  }
}

for (const compressed of [true, false]) {
  test(`viewer transport preserves snapshots with compression ${compressed ? "enabled" : "declined"}`, { timeout: 10_000 }, async (t) => {
    const server = createServer();
    const wss = new WebSocketServer({ server, perMessageDeflate: SNAPSHOT_COMPRESSION });
    let transport: Socket | undefined;
    server.on("connection", (socket) => { transport = socket; });
    t.after(() => {
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      server.close();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const connected = once(wss, "connection");
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`, { perMessageDeflate: compressed });
    t.after(() => client.terminate());
    await once(client, "open");
    const [viewer] = await connected as [WebSocket];
    assert.equal(client.extensions.includes("permessage-deflate"), compressed);

    const store = new StateStore();
    // Populate the same full 41-car state used by the live demo, without arming
    // the store's telemetry-staleness timer in this transport test.
    let message: ServerMessage = { type: "state.snapshot", payload: store.snapshot() };
    const stop = startSimulator({ telemetry(session) {
      const state = store.snapshot();
      state.session = session;
      state.sessionResults[session.type] = session;
      message = { type: "state.snapshot", payload: state };
    } } as StateStore);
    stop();
    const rawBytes = Buffer.byteLength(JSON.stringify(message));
    const before = transport!.bytesWritten;
    const received = once(client, "message");
    broadcastStateSnapshot(new Map([[viewer, "overlay" as const]]), message);
    const [data] = await received;
    assert.equal(data.toString(), JSON.stringify(message));
    const wireBytes = transport!.bytesWritten - before;
    if (compressed) assert.ok(wireBytes < rawBytes * 0.25, `${wireBytes} wire bytes / ${rawBytes} JSON bytes`);
    else assert.ok(wireBytes >= rawBytes);
    t.diagnostic(`${rawBytes} JSON bytes -> ${wireBytes} WebSocket bytes`);
  });
}

test("state snapshots are sent to viewers but never echoed to telemetry ingestion sockets", () => {
  const control = new RecordingSocket();
  const overlay = new RecordingSocket();
  const commentator = new RecordingSocket();
  const telemetry = new RecordingSocket();
  const closedControl = new RecordingSocket(WebSocket.CLOSED);
  const slowControl = new RecordingSocket(WebSocket.OPEN, MAX_BROADCAST_BUFFER_BYTES + 1);
  const sockets = new Map<BroadcastSocket, SocketRole>([
    [control, "control"],
    [overlay, "overlay"],
    [commentator, "commentator"],
    [telemetry, "telemetry"],
    [closedControl, "control"],
    [slowControl, "control"],
  ]);
  const message = { type: "error", message: "test snapshot" } satisfies ServerMessage;

  broadcastStateSnapshot(sockets, message);

  assert.deepEqual(control.sent, [JSON.stringify(message)]);
  assert.deepEqual(overlay.sent, [JSON.stringify(message)]);
  assert.deepEqual(commentator.sent, [JSON.stringify(message)]);
  assert.deepEqual(telemetry.sent, []);
  assert.deepEqual(closedControl.sent, []);
  assert.deepEqual(slowControl.sent, []);
});
