import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ControlCommand, LiveState, ServerMessage } from "@racecontrol/protocol";

export function useLiveState(role: "control" | "overlay") {
  const [state, setState] = useState<LiveState | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/socket`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        setSocketConnected(true);
        const hello: ClientMessage = { type: "hello", role };
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
  }, [role]);

  const command = useCallback((command: ControlCommand) => {
    const message: ClientMessage = { type: "control.command", command };
    socketRef.current?.send(JSON.stringify(message));
  }, []);

  return { state, socketConnected, command };
}
