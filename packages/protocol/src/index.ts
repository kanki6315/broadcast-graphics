export const graphicSlots = [
  "timing-tower",
  "results",
  "race-status",
  "weather",
  "driver-focus",
  "battle",
  "lower-third",
] as const;

export type GraphicSlot = (typeof graphicSlots)[number];
export type SessionType = "practice" | "qualifying" | "race";
export type ConnectionStatus = "connected" | "stale" | "disconnected";
export type SessionFlag = "green" | "yellow" | "red" | "white" | "checkered";
export type SessionPhase = "invalid" | "get-in-car" | "warmup" | "parade-laps" | "racing" | "checkered" | "cool-down";
export type StartState = "hidden" | "ready" | "set" | "go";
export type TrackStatus = "unknown" | "running" | "pit" | "off-track" | "not-in-world" | "retired";
export type PitState = "not-in-pits" | "pit-lane" | "pit-stall" | "unobserved";
export type TelemetrySource = "iracing" | "simulation";
export type TelemetrySourceMode = "live" | "replay" | "simulation";
export type AccessKeyKind = "ingestion" | "view";
export type TimingWorkspaceMode = "operator" | "commentator";

export type InvalidTimingReason =
  | "telemetry-gap"
  | "lap-jump"
  | "position-reset"
  | "implausible-movement"
  | "tow"
  | "pit-transition"
  | "invalid-crossing-order"
  | "session-transition"
  | "insufficient-samples"
  | "definition-mismatch";

export type TimingQuality = "valid" | "inferred" | "incomplete" | "invalid";
export type TimingSource = "iracing" | "derived";

export interface TimingValue {
  value?: number;
  source: TimingSource;
  quality: TimingQuality;
  reason?: InvalidTimingReason;
  observedAt?: number;
  completedAt?: number;
}

export type DriverTimingField =
  | "lapDistPct"
  | "gapToLeader"
  | "intervalToAhead"
  | "classGapToLeader"
  | "classIntervalToAhead"
  | "lastLap"
  | "bestLap";

export type TimingQualityMetadata = Omit<TimingValue, "value">;

export interface SectorBoundary {
  sectorNumber: number;
  startPct: number;
}

export interface TrackLayoutIdentity {
  trackId?: number | null;
  configurationId?: number | null;
  trackName: string;
  configurationName?: string | null;
  trackLengthMeters?: number | null;
}

export type TrackMapSource = "iracing" | "imported" | "bundled";

export interface TrackMapPathCandidate {
  id: string;
  pathData: string;
  length: number;
  closed: boolean;
}

export interface TrackMapDefinition {
  id: string;
  layout: TrackLayoutIdentity;
  source: TrackMapSource;
  sourceChecksum: string;
  sourceVersion?: string | null;
  originalFilename?: string | null;
  importedAt: string;
  sanitizationStatus: "sanitized" | "bundled" | "verified";
  sanitizedSvg?: string;
  centerlinePath: string;
  centerlinePathId: string;
  suggestedStartFinishPathPct?: number | null;
  startFinishMarkerPaths?: string[];
  viewBox: [number, number, number, number];
  createdAt: string;
}

export interface TrackMapCalibration {
  id: string;
  mapDefinitionId: string;
  revision: number;
  startFinishPathPct: number;
  direction: "forward" | "reverse";
  rotationDegrees?: number;
  active: boolean;
  createdAt: string;
  createdBy?: string | null;
}

export interface ActiveTrackMap {
  mapDefinitionId: string;
  calibrationId: string;
  calibrationRevision: number;
  sourceChecksum: string;
}

export interface SectorDefinition {
  revision: string;
  source: "iracing" | "custom";
  sessionId: string;
  trackId?: number | null;
  trackName: string;
  boundaries: SectorBoundary[];
  layout?: TrackLayoutIdentity;
  mapCalibrationId?: string | null;
  mapCalibrationRevision?: number | null;
  createdAt?: string;
  createdBy?: string | null;
  active?: boolean;
  draft?: boolean;
  locked?: boolean;
  effectiveSessionId?: string | null;
  effectiveAt?: string | null;
}

export interface SectorDefinitionRevision extends SectorDefinition {
  createdAt: string;
  active: boolean;
  draft: boolean;
  locked: boolean;
}

export interface TrackConfigurationSnapshot {
  layout: TrackLayoutIdentity;
  activeMap?: ActiveTrackMap | null;
  activeSectorDefinition?: Pick<SectorDefinitionRevision, "revision" | "source" | "boundaries" | "mapCalibrationId" | "mapCalibrationRevision" | "locked"> | null;
}

export type SectorComparison = "personal-best" | "class-fastest" | "overall-fastest";

export interface CompletedSector extends TimingValue {
  carIdx: number;
  driverId?: string;
  driverName?: string;
  lapNumber: number;
  sectorNumber: number;
  definitionRevision: string;
  comparisons?: SectorComparison[];
}

export interface DriverSectorTiming {
  currentSectorNumber?: number;
  currentLap?: CompletedSector[];
  previousLap?: CompletedSector[];
}

export interface PitVisitTiming {
  pitEntryTime: number;
  pitExitTime?: number;
  pitLaneTime: number;
  boxTime: number;
  unknownTime: number;
  observedBoxTime: number;
  inferredBoxTime: number;
  driverChange: boolean;
  entryDriverId?: string;
  exitDriverId?: string;
  quality: "valid" | "contains-inference" | "incomplete";
}

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
  /** Detailed pit lifecycle state. Separate from the broader trackStatus location. */
  pitState?: PitState;
  /** The open pit visit, or the most recently completed visit when no visit is open. */
  latestPitVisit?: PitVisitTiming | null;
  /** Immutable race-start baselines. Null means a trustworthy baseline was unavailable. */
  startingPosition?: number | null;
  startingClassPosition?: number | null;
  /** Positive values mean positions gained; negative values mean positions lost. */
  positionChange?: number | null;
  classPositionChange?: number | null;
  /** Provenance and quality for timing fields without replacing legacy numeric values. */
  timingQuality?: Partial<Record<DriverTimingField, TimingQualityMetadata>>;
  /** Locally derived sector timing. Omitted by older telemetry producers. */
  sectors?: DriverSectorTiming;
  isConnected: boolean;
  userId: number;
  teamId: number;
  carId: number;
  lastLapPosition: number | null;
  lastLapClassPosition: number | null;
  lastLapGapToLeader: number | null;
  lastLapGapToClassLeader: number | null;
  lastLapLapsBehindLeader: number | null;
  lastLapLapsBehindClassLeader: number | null;
}

/** True when a timing field has no meaningful value for the driver's current race position. */
export function isExpectedUnavailableTimingField(driver: DriverState, field: string): boolean {
  switch (field) {
    case "gapToLeader":
      return driver.position === 1 || driver.lapsBehindLeader > 0;
    case "intervalToAhead":
      return driver.position === 1;
    case "classGapToLeader":
      return driver.classPosition === 1 || driver.lapsBehindClassLeader > 0;
    case "classIntervalToAhead":
      return driver.classPosition === 1;
    default:
      return false;
  }
}

export interface CarClassState {
  id: number;
  name: string;
  color: string;
  carCount: number;
}

export interface WeatherState {
  condition: "clear" | "partly-cloudy" | "cloudy";
  airTemperatureC: number | null;
  trackTemperatureC: number | null;
  windSpeedMps: number | null;
  windDirectionRadians: number | null;
  relativeHumidityPercent: number | null;
}

export interface CameraDefinition {
  number: number;
  name: string;
}

export interface CameraGroupDefinition {
  number: number;
  name: string;
  isScenic: boolean;
  cameras: CameraDefinition[];
}

export interface SessionState {
  id: string;
  name: string;
  type: SessionType;
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
  source: TelemetrySource;
  sourceMode: TelemetrySourceMode;
  externalSubSessionId: number | null;
  externalSessionNumber: number | null;
  trackId: number | null;
  weather?: WeatherState | null;
  cameraGroups?: CameraGroupDefinition[];
  activeCameraCarIdx?: number | null;
  activeCameraGroup?: number | null;
  activeCamera?: number | null;
  /** Native iRacing sector boundaries, normalized and revisioned by the Windows client. */
  sectorDefinition?: SectorDefinition | null;
}

export interface CompletedLap {
  id: string;
  sessionId: string;
  source: TelemetrySource;
  sourceMode: TelemetrySourceMode;
  carIdx: number;
  carNumber: string;
  driverName: string;
  classId: number;
  className: string;
  lapNumber: number;
  lapTime: number;
  position: number | null;
  classPosition: number | null;
  gapToLeader: number | null;
  gapToClassLeader: number | null;
  lapsBehindLeader: number | null;
  lapsBehindClassLeader: number | null;
  personalBest: boolean;
  sessionTime: number | null;
  flag: SessionFlag;
  phase: SessionPhase;
  observedAt: string;
}

export type TrendDirection = "opening" | "closing" | "stable";
export type TrendSuppressionReason =
  | "telemetry-gap"
  | "pit-transition"
  | "tow"
  | "position-reset"
  | "insufficient-history"
  | "lap-deficit"
  | "session-transition"
  | "caution";

export interface GapTrend {
  id: string;
  referenceCarIdx: number;
  chasingCarIdx: number;
  classId: number;
  currentGap?: number;
  lapDeficit: number;
  windowSeconds: number;
  gapChange?: number;
  rate?: number;
  direction?: TrendDirection;
  quality: TimingQuality;
  suppressionReason?: TrendSuppressionReason;
}

export interface BattleSummary {
  id: string;
  classId: number;
  className: string;
  carIdxs: number[];
  currentGap?: number;
  lapDeficit: number;
  windowSeconds: number;
  direction?: TrendDirection;
  rate?: number;
  quality: TimingQuality;
  suppressionReason?: TrendSuppressionReason;
}

export interface PitCycleSummary {
  carIdx: number;
  stopCount: number;
  lastPitEntryTime?: number;
  lastPitExitTime?: number;
  totalPitLaneTime: number;
  totalBoxTime: number;
  totalUnknownTime: number;
  quality: TimingQuality;
}

export type DriverChangeContext = "observed-box" | "inferred-box" | "unresolved" | "away-from-pits";

export interface CompletedDriverStint {
  driverId: string;
  driverName: string;
  startedAt: number;
  endedAt: number;
  duration: number;
  lapCount: number;
  changeContext: DriverChangeContext;
  associatedPitEntryTime?: number;
  quality: TimingQuality;
}

export interface DriverStintSummary {
  carIdx: number;
  currentDriverId: string;
  currentDriverName: string;
  previousDriverId?: string;
  previousDriverName?: string;
  startedAt: number;
  duration: number;
  lapCount: number;
  recentCompleted?: CompletedDriverStint;
  changeContext?: DriverChangeContext;
  associatedPitEntryTime?: number;
  quality: TimingQuality;
}

export interface TimingQualityWarning {
  id: string;
  carIdx?: number;
  field: string;
  quality: Exclude<TimingQuality, "valid">;
  reason?: InvalidTimingReason | TrendSuppressionReason;
  message: string;
  observedAt: number;
}

export interface RaceIntelligenceSnapshot {
  sessionId: string;
  sectorDefinitionRevision?: string | null;
  generatedAt: number;
  battles: BattleSummary[];
  gapTrends: GapTrend[];
  pitCycles: PitCycleSummary[];
  stints: DriverStintSummary[];
  qualityWarnings: TimingQualityWarning[];
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

export interface CameraControlState {
  controller: "ready" | "unavailable" | "disconnected";
  groups: CameraGroupDefinition[];
  selectedGroup: number | null;
  activeCarIdx: number | null;
  activeGroup: number | null;
  activeCamera: number | null;
  pendingCommandId: string | null;
  lastResult: "sent" | "rejected" | null;
  lastMessage: string | null;
}

export interface CameraSwitchCommand {
  id: string;
  carIdx: number;
  carNumber: string;
  cameraGroup: number;
  camera: number;
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
  sessionResults: Partial<Record<SessionType, SessionState>>;
  graphics: GraphicsState;
  camera: CameraControlState;
  events: EventRecord[];
  /** Shared session-scoped cache; absent until the server has normalized live evidence. */
  intelligence?: RaceIntelligenceSnapshot | null;
  /** Compact, low-frequency identifiers. Full sanitized geometry is fetched over HTTP. */
  trackConfiguration?: TrackConfigurationSnapshot | null;
}

export type ControlCommand =
  | { type: "focus.set"; carIdx: number }
  | { type: "camera.group.set"; cameraGroup: number }
  | { type: "camera.group.take"; cameraGroup: number }
  | { type: "camera.driver.take"; carIdx: number; cameraGroup: number }
  | { type: "camera.take" }
  | { type: "graphics.arm"; slot: GraphicSlot }
  | { type: "graphics.take"; slot: GraphicSlot }
  | { type: "graphics.clear"; slot: GraphicSlot }
  | { type: "graphics.clearAll" }
  | { type: "graphics.package.set"; packageId: string }
  | { type: "graphics.config.set"; slot: GraphicSlot; key: string; value: string | number | boolean };

export type ClientMessage =
  | { type: "hello"; role: "telemetry" | "control" | "overlay"; mode?: TimingWorkspaceMode; clientId?: string; capabilities?: { cameraControl?: boolean } }
  | { type: "telemetry.update"; sequence?: number; payload: SessionState }
  | { type: "camera.result"; commandId: string; status: "sent" | "rejected"; message: string }
  | { type: "lap.history.request"; carIdx: number; limit?: number }
  | { type: "control.command"; command: ControlCommand };

export type ServerMessage =
  | { type: "state.snapshot"; payload: LiveState }
  | { type: "telemetry.ack"; sequence: number }
  | { type: "camera.command"; command: CameraSwitchCommand }
  | { type: "sector.definition"; payload: SectorDefinition | null }
  | { type: "lap.completed"; payload: CompletedLap }
  | { type: "lap.history"; payload: CompletedLap[] }
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
