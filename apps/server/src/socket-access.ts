import type { ClientMessage, TimingWorkspaceMode } from "@racecontrol/protocol";
import type { SocketRole } from "./socket-broadcast.js";

export type RequestedSocketRole = "control" | "overlay" | "telemetry";

export interface SocketAccess {
  requestedRole: RequestedSocketRole;
  mode: TimingWorkspaceMode;
  role: SocketRole;
}

export function parseSocketAccess(rawUrl: string | undefined): SocketAccess | null {
  const url = new URL(rawUrl ?? "/socket", "http://localhost");
  const requestedRole = url.searchParams.get("role");
  if (requestedRole !== "control" && requestedRole !== "overlay" && requestedRole !== "telemetry") return null;
  const requestedMode = url.searchParams.get("mode");
  if (requestedMode !== null && requestedMode !== "operator" && requestedMode !== "commentator") return null;
  if (requestedRole !== "control" && requestedMode !== null) return null;
  const mode = requestedRole === "control" ? requestedMode ?? "operator" : "operator";
  return {
    requestedRole,
    mode,
    role: requestedRole === "control" && mode === "commentator" ? "commentator" : requestedRole,
  };
}

export function helloMatchesAccess(message: Extract<ClientMessage, { type: "hello" }>, access: SocketAccess): boolean {
  if (message.role !== access.requestedRole) return false;
  return access.requestedRole !== "control" || (message.mode ?? "operator") === access.mode;
}

export function canIssueControlCommands(role: SocketRole): boolean {
  return role === "control";
}
