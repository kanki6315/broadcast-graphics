export const graphicSlots = [
  "timing-tower",
  "race-status",
  "driver-focus",
  "battle",
  "flag",
  "lower-third",
] as const;

export type GraphicSlot = (typeof graphicSlots)[number];
export type ConnectionStatus = "connected" | "stale" | "disconnected";
export type SessionFlag = "green" | "yellow" | "red" | "white" | "checkered";
export type SessionPhase = "invalid" | "get-in-car" | "warmup" | "parade-laps" | "racing" | "checkered" | "cool-down";
export type StartState = "hidden" | "ready" | "set" | "go";
export type TrackStatus = "unknown" | "running" | "pit" | "off-track" | "not-in-world" | "retired";
export type AccessKeyKind = "ingestion" | "view";

export interface AccessKey {
  id: string;
  kind: AccessKeyKind;
  label: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedAccessKey {
  key: AccessKey;
  secret: string;
}

export interface DriverState {
  carIdx: number;
  position: number;
  carNumber: string;
  name: string;
  team: string;
  className: string;
  /** @deprecated Use gapToLeader. Retained for format-1 diagnostic replay compatibility. */
  interval: number | null;
  lastLap: number | null;
  bestLap: number | null;
  lapsCompleted: number;
  onPitRoad: boolean;
  incidents: number;
  classId: number;
  classColor: string;
  classPosition: number;
  gapToLeader: number | null;
  intervalToAhead: number | null;
  classGapToLeader: number | null;
  classIntervalToAhead: number | null;
  lapsBehindLeader: number;
  lapsBehindClassLeader: number;
  currentLap: number;
  lastLapNumber: number | null;
  bestLapNumber: number | null;
  lapDistPct: number | null;
  trackStatus: TrackStatus;
  isConnected: boolean;
}

export interface CarClassState {
  id: number;
  name: string;
  color: string;
  carCount: number;
}

export interface SessionState {
  id: string;
  name: string;
  type: "practice" | "qualifying" | "race";
  trackName: string;
  lap: number;
  totalLaps: number | null;
  timeRemaining: number | null;
  flag: SessionFlag;
  timestamp: string;
  drivers: DriverState[];
  lapsCompleted: number;
  lapsRemaining: number | null;
  timeElapsed: number | null;
  totalTime: number | null;
  phase: SessionPhase;
  startState: StartState;
  flags: string[];
  classes: CarClassState[];
}

export type GraphicFieldType = "text" | "boolean" | "select" | "number";

export interface GraphicFieldOption {
  label: string;
  value: string;
}

export interface GraphicFieldDefinition {
  key: string;
  label: string;
  type: GraphicFieldType;
  default: string | number | boolean;
  options?: GraphicFieldOption[];
  min?: number;
  max?: number;
  source?: "operator" | "selected-driver" | "session";
}

export interface GraphicPackageManifest {
  id: string;
  name: string;
  clientName: string;
  version: string;
  themeUrl: string;
  slots: Record<GraphicSlot, {
    label: string;
    description: string;
    fields: GraphicFieldDefinition[];
  }>;
}

export interface GraphicsState {
  packageId: string;
  activeSlots: GraphicSlot[];
  armedSlot: GraphicSlot | null;
  selectedDriverCarIdx: number | null;
  slotConfig: Partial<Record<GraphicSlot, Record<string, string | number | boolean>>>;
}

export interface EventRecord {
  id: string;
  at: string;
  kind: "telemetry" | "operator" | "system";
  message: string;
}

export interface LiveState {
  revision: number;
  connection: ConnectionStatus;
  session: SessionState | null;
  graphics: GraphicsState;
  events: EventRecord[];
}

export type ControlCommand =
  | { type: "focus.set"; carIdx: number }
  | { type: "graphics.arm"; slot: GraphicSlot }
  | { type: "graphics.take"; slot: GraphicSlot }
  | { type: "graphics.clear"; slot: GraphicSlot }
  | { type: "graphics.clearAll" }
  | { type: "graphics.package.set"; packageId: string }
  | { type: "graphics.config.set"; slot: GraphicSlot; key: string; value: string | number | boolean };

export type ClientMessage =
  | { type: "hello"; role: "telemetry" | "control" | "overlay"; clientId?: string }
  | { type: "telemetry.update"; payload: SessionState }
  | { type: "control.command"; command: ControlCommand };

export type ServerMessage =
  | { type: "state.snapshot"; payload: LiveState }
  | { type: "error"; message: string };

export function formatLapTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}

export function isGraphicSlot(value: string): value is GraphicSlot {
  return graphicSlots.includes(value as GraphicSlot);
}
