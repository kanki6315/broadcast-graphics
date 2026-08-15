import { WebSocket } from "ws";
import type { ServerMessage } from "@racecontrol/protocol";

export type SocketRole = "control" | "commentator" | "overlay" | "telemetry";

export interface BroadcastSocket {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string): unknown;
}

export const MAX_BROADCAST_BUFFER_BYTES = 1_048_576;

export function broadcastStateSnapshot(
  sockets: Iterable<readonly [BroadcastSocket, SocketRole]>,
  message: ServerMessage,
): void {
  const serialized = JSON.stringify(message);
  for (const [socket, role] of sockets) {
    if (role !== "telemetry" && socket.readyState === WebSocket.OPEN
      && (socket.bufferedAmount ?? 0) <= MAX_BROADCAST_BUFFER_BYTES) socket.send(serialized);
  }
}
