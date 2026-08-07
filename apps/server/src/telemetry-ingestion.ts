import type { ClientMessage, SessionState } from "@racecontrol/protocol";

type TelemetryMessage = Extract<ClientMessage, { type: "telemetry.update" }>;

export interface TelemetryStateTarget {
  telemetry(session: SessionState): void;
}

export interface TelemetryHistoryTarget {
  ingest(session: SessionState): void;
}

export function acceptTelemetry(
  message: TelemetryMessage,
  store: TelemetryStateTarget,
  history: TelemetryHistoryTarget,
): number | null {
  if (message.sequence !== undefined && (!Number.isSafeInteger(message.sequence) || message.sequence <= 0)) {
    throw new Error("Telemetry sequence must be a positive safe integer.");
  }
  if (!message.payload || typeof message.payload !== "object") {
    throw new Error("Telemetry payload is required.");
  }

  store.telemetry(message.payload);
  history.ingest(message.payload);
  return message.sequence ?? null;
}
