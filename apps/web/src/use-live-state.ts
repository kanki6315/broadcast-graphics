import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ControlCommand, LiveState, ServerMessage, TimingWorkspaceMode } from "@racecontrol/protocol";

export function useLiveState(role: "control" | "overlay", mode: TimingWorkspaceMode = "operator") {
  const [state, setState] = useState<LiveState | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const query = new URLSearchParams({ role });
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
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "state.snapshot") setState(message.payload);
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
