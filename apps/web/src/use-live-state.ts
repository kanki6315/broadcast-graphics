import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ControlCommand, LiveState, ServerMessage, TimingWorkspaceMode } from "@racecontrol/protocol";
import { liveStateFromViewer, receiveViewerState, type ViewerState } from "@racecontrol/protocol";

export function useLiveState(role: "control" | "overlay", mode: TimingWorkspaceMode = "operator") {
  const [state, setState] = useState<LiveState | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const query = new URLSearchParams({ role, state: "delta-v1" });
      let viewer: ViewerState | null = null;
      if (role === "control") query.set("mode", mode);
      let socketProtocols: string[] | undefined;
      if (role === "overlay") {
        const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
        if (token) socketProtocols = ["bg-view", token];
      } else if (mode === "commentator") {
        const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
        if (token?.startsWith("bg_comms_")) socketProtocols = ["bg-commentator", token];
      }
      const socket = new WebSocket(`${protocol}//${window.location.host}/socket?${query}`, socketProtocols);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setSocketConnected(true);
        const hello: ClientMessage = role === "control" ? { type: "hello", role, mode } : { type: "hello", role };
        socket.send(JSON.stringify(hello));
      });
      socket.addEventListener("message", (event) => {
        if (stopped || socketRef.current !== socket) return;
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "state.snapshot") setState(message.payload);
        if (message.type === "state.init" || message.type === "state.delta") {
          try {
            viewer = receiveViewerState(viewer, message);
            setState(liveStateFromViewer(viewer));
          } catch {
            // Reconnect for a fresh baseline rather than displaying partial state.
            socket.close(1000, "State resynchronization required");
          }
        }
      });
      socket.addEventListener("close", () => {
        setSocketConnected(false);
        if (!stopped) retry = window.setTimeout(connect, 1_200);
      });
    };

    connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [mode, role]);

  const command = useCallback((command: ControlCommand) => {
    const message: ClientMessage = { type: "control.command", command };
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  return { state, socketConnected, command };
}
