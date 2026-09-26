import { WebSocket, type ServerOptions } from "ws";
import type { ServerMessage } from "@racecontrol/protocol";
import { diffState, viewerState, type LiveState, type ViewerState, type ViewerStateMessage } from "@racecontrol/protocol";

export type SocketRole = "control" | "commentator" | "overlay" | "telemetry";

export interface BroadcastSocket {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string): unknown;
}

export const MAX_BROADCAST_BUFFER_BYTES = 1_048_576;
export const VIEWER_UPDATE_INTERVAL_MS = 1_000;

export class ViewerStateBroadcaster {
  private readonly baselines = new WeakMap<BroadcastSocket, ViewerState | null>();

  enable(socket: BroadcastSocket): void {
    this.baselines.set(socket, null);
  }

  broadcast(sockets: Iterable<readonly [BroadcastSocket, SocketRole]>, state: LiveState): void {
    let next: ViewerState | undefined;
    let legacy: string | undefined;
    for (const [socket, role] of sockets) {
      if (role === "telemetry" || socket.readyState !== WebSocket.OPEN
        || (socket.bufferedAmount ?? 0) > MAX_BROADCAST_BUFFER_BYTES) continue;
      if (!this.baselines.has(socket)) {
        socket.send(legacy ??= JSON.stringify({ type: "state.snapshot", payload: state }));
        continue;
      }
      next ??= viewerState(state);
      const previous = this.baselines.get(socket);
      if (previous?.revision === next.revision) continue;
      let message: ViewerStateMessage;
      if (!previous) message = { type: "state.init", payload: next };
      else {
        const history = diffState(previous.history, next.history);
        message = { type: "state.delta", baseRevision: previous.revision, revision: next.revision,
          live: diffState(previous.live, next.live), ...(history.length ? { history } : {}) };
      }
      // Large resets can be cheaper as a fresh baseline than as many patch paths.
      const encoded = JSON.stringify(message);
      const full = JSON.stringify({ type: "state.init", payload: next } satisfies ViewerStateMessage);
      socket.send(encoded.length < full.length ? encoded : full);
      this.baselines.set(socket, next);
    }
  }
}

/** Coalesce routine notifications; read the latest state only when sending. */
export class ViewerBroadcastScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly broadcast: () => void) {}

  request(delivery: "routine" | "immediate"): void {
    if (delivery === "immediate") {
      this.cancel();
      this.broadcast();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.broadcast();
      }, VIEWER_UPDATE_INTERVAL_MS);
    }
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

// Browsers negotiate this transparently; older clients can still use plain frames.
// Bound zlib work and memory, and avoid retaining data between messages.
export const SNAPSHOT_COMPRESSION: ServerOptions["perMessageDeflate"] = {
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
  concurrencyLimit: 4,
  threshold: 1_024,
  zlibDeflateOptions: { level: 3 },
};

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
