import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import type { ServerMessage } from "@racecontrol/protocol";
import { broadcastStateSnapshot, MAX_BROADCAST_BUFFER_BYTES, type BroadcastSocket, type SocketRole } from "./socket-broadcast.js";

class RecordingSocket implements BroadcastSocket {
  readonly sent: string[] = [];

  constructor(public readonly readyState: number = WebSocket.OPEN, public readonly bufferedAmount = 0) {}

  send(data: string): void {
    this.sent.push(data);
  }
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
