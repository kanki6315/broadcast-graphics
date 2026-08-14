import type { ClientMessage, RaceIntelligenceSnapshot, SessionState } from "@racecontrol/protocol";

type TelemetryMessage = Extract<ClientMessage, { type: "telemetry.update" }>;

export interface TelemetryStateTarget {
  telemetry(session: SessionState): void;
  raceIntelligence?(snapshot: RaceIntelligenceSnapshot | null): void;
}

export interface TelemetryHistoryTarget {
  ingest(session: SessionState): void;
}

export interface TelemetryIntelligenceTarget {
  ingest(session: SessionState): void;
  snapshot(): RaceIntelligenceSnapshot | null;
}

export function acceptTelemetry(
  message: TelemetryMessage,
  store: TelemetryStateTarget,
  history: TelemetryHistoryTarget,
  intelligence?: TelemetryIntelligenceTarget,
): number | null {
  if (message.sequence !== undefined && (!Number.isSafeInteger(message.sequence) || message.sequence <= 0)) {
    throw new Error("Telemetry sequence must be a positive safe integer.");
  }
  if (!message.payload || typeof message.payload !== "object") {
    throw new Error("Telemetry payload is required.");
  }

  intelligence?.ingest(message.payload);
  store.raceIntelligence?.(intelligence?.snapshot() ?? null);
  store.telemetry(message.payload);
  history.ingest(message.payload);
  return message.sequence ?? null;
}
