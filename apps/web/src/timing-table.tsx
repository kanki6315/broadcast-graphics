import {
  formatLapTime,
  type DriverState,
  type DriverStintSummary,
  type DriverTimingField,
  type GapTrend,
  type PitCycleSummary,
  type CompletedSector,
  type TimingQualityMetadata,
} from "@racecontrol/protocol";
import React from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface TimingTableProps {
  drivers: DriverState[];
  selectedCarIdx: number | null;
  activeCameraCarIdx?: number | null;
  fastestCarIdx?: number;
  selectionPending?: boolean;
  onSelectCar: (carIdx: number) => void;
  selectionLabel?: (driver: DriverState) => string;
}

function driverStatus(driver: DriverState): string {
  if (driver.pitState === "pit-stall") return "In box";
  if (driver.pitState === "pit-lane") return "Pit lane";
  if (driver.pitState === "unobserved") return "Unobserved";
  if (driver.trackStatus === "pit") return "Pit";
  if (driver.trackStatus === "off-track") return "Off track";
  if (driver.trackStatus === "not-in-world") return "Out";
  if (driver.trackStatus === "retired") return "Retired";
  if (!driver.isConnected) return "Disconnected";
  return "Running";
}

export function TimingTable({
  drivers,
  selectedCarIdx,
  activeCameraCarIdx,
  fastestCarIdx,
  selectionPending = false,
  onSelectCar,
  selectionLabel = (driver) => `Select ${driver.name}, position ${driver.position}`,
}: TimingTableProps) {
  function handleRowKeyDown(carIdx: number, event: ReactKeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectCar(carIdx);
  }

  return (
    <div className="timing-table-wrap">
      <table className="timing-table">
        <thead><tr><th>Pos</th><th>No.</th><th>Driver / team</th><th>Gap</th><th>Interval</th><th>Last lap</th><th>Best lap</th><th>Laps</th><th>Status</th></tr></thead>
        <tbody>
          {drivers.map((driver) => {
            const selected = driver.carIdx === selectedCarIdx;
            const onCamera = driver.carIdx === activeCameraCarIdx;
            const fastest = driver.carIdx === fastestCarIdx;
            const status = driverStatus(driver);
            const inPits = driver.pitState === "pit-lane" || driver.pitState === "pit-stall" || driver.trackStatus === "pit";
            return (
              <tr
                key={driver.carIdx}
                className={`${selected ? "is-selected" : ""}${onCamera ? " is-on-camera" : ""}${selectionPending ? " is-busy" : ""}`}
                onClick={() => onSelectCar(driver.carIdx)}
                onKeyDown={(event) => handleRowKeyDown(driver.carIdx, event)}
                tabIndex={0}
                aria-label={selectionLabel(driver)}
                aria-current={onCamera ? "true" : undefined}
              >
                <td><span className="position-stamp">{driver.position}</span></td>
                <td><span className="car-number">{driver.carNumber}</span></td>
                <td><span className="timing-driver"><strong>{driver.name}</strong><span>{driver.team}</span></span></td>
                <td className="numeric">{driver.position === 1 ? "Leader" : driver.lapsBehindLeader > 0 ? `+${driver.lapsBehindLeader}L` : driver.gapToLeader == null ? "—" : `+${driver.gapToLeader.toFixed(3)}`}</td>
                <td className="numeric">{driver.position === 1 ? "—" : driver.intervalToAhead == null ? "—" : `+${driver.intervalToAhead.toFixed(3)}`}</td>
                <td className="numeric">{formatLapTime(driver.lastLap)}</td>
                <td className={`numeric ${fastest ? "fastest" : ""}`}>{formatLapTime(driver.bestLap)}</td>
                <td className="numeric">{driver.lapsCompleted}</td>
                <td><span className={`status-tag ${inPits ? "pit" : "running"}`}>{status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {drivers.length === 0 && <div className="timing-empty">Waiting for timing entries from iRacing.</div>}
    </div>
  );
}

export type CommentatorColumn = "change" | "lap" | "gap" | "interval" | "lapTimes" | "sectors" | "stint" | "pit" | "status";

export const commentatorColumnLabels: Record<CommentatorColumn, string> = {
  change: "Position change",
  lap: "Lap progress",
  gap: "Gaps",
  interval: "Intervals",
  lapTimes: "Lap times",
  sectors: "Sectors",
  stint: "Driver stint",
  pit: "Pit visit",
  status: "Status",
};

export const defaultCommentatorColumns: readonly CommentatorColumn[] = [
  "change",
  "gap",
  "interval",
  "lapTimes",
  "sectors",
  "stint",
  "pit",
  "status",
];

function sortablePosition(position: number): number {
  return position > 0 ? position : Number.MAX_SAFE_INTEGER;
}

export function sortByClassPosition(drivers: DriverState[]): DriverState[] {
  return [...drivers].sort((left, right) =>
    sortablePosition(left.classPosition) - sortablePosition(right.classPosition)
      || sortablePosition(left.position) - sortablePosition(right.position)
      || left.className.localeCompare(right.className)
      || left.carIdx - right.carIdx);
}

export interface CommentatorTimingTableProps {
  drivers: DriverState[];
  selectedCarIdx: number | null;
  nearbyCarIdxs: ReadonlySet<number>;
  expandedCarIdxs: ReadonlySet<number>;
  visibleColumns: ReadonlySet<CommentatorColumn>;
  groupByClass: boolean;
  stints?: DriverStintSummary[];
  gapTrends?: GapTrend[];
  pitCycles?: PitCycleSummary[];
  onSelectCar: (carIdx: number) => void;
  onToggleExpanded: (carIdx: number) => void;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(3)}s`;
}

function qualityLabel(quality: TimingQualityMetadata | undefined): string {
  if (!quality) return "Quality not reported";
  const reason = quality.reason ? `: ${quality.reason.replaceAll("-", " ")}` : "";
  return `${quality.quality}${reason}`;
}

function qualityValue(
  value: number | null | undefined,
  quality: TimingQualityMetadata | undefined,
  formatter: (value: number) => string,
  empty = "--",
) {
  if (value == null || quality?.quality === "invalid" || quality?.quality === "incomplete") {
    return <span className="quality-value is-unavailable" title={qualityLabel(quality)}>{empty}</span>;
  }
  const marker = quality?.quality === "inferred" ? "~" : quality == null ? "?" : "";
  return <span className={`quality-value${marker ? " has-marker" : ""}`} title={qualityLabel(quality)}>{marker}{formatter(value)}</span>;
}

function timingQuality(driver: DriverState, field: DriverTimingField): TimingQualityMetadata | undefined {
  return driver.timingQuality?.[field];
}

function positionDelta(value: number | null | undefined) {
  if (value == null) return <span className="position-change is-unknown">--</span>;
  if (value === 0) return <span className="position-change is-neutral">0</span>;
  return <span className={`position-change ${value > 0 ? "is-gain" : "is-loss"}`}>{value > 0 ? "+" : ""}{value}</span>;
}

function gapValue(driver: DriverState, classValue: boolean) {
  const position = classValue ? driver.classPosition : driver.position;
  if (position === 1) return <span className="quality-value">Leader</span>;
  const lapsBehind = classValue ? driver.lapsBehindClassLeader : driver.lapsBehindLeader;
  if (lapsBehind > 0) return <span className="quality-value">+{lapsBehind}L</span>;
  const field: DriverTimingField = classValue ? "classGapToLeader" : "gapToLeader";
  return qualityValue(driver[field], timingQuality(driver, field), formatSeconds);
}

function intervalValue(driver: DriverState, classValue: boolean) {
  const position = classValue ? driver.classPosition : driver.position;
  if (position === 1) return <span className="quality-value">--</span>;
  const field: DriverTimingField = classValue ? "classIntervalToAhead" : "intervalToAhead";
  return qualityValue(driver[field], timingQuality(driver, field), formatSeconds);
}

function lapTimeValue(driver: DriverState, field: "lastLap" | "bestLap") {
  return qualityValue(driver[field], timingQuality(driver, field), formatLapTime);
}

function pitVisitSummary(driver: DriverState) {
  const visit = driver.latestPitVisit;
  if (!Object.hasOwn(driver, "latestPitVisit")) return <span className="pit-summary is-empty" title="This producer does not report pit summaries">--</span>;
  if (!visit) return <span className="pit-summary is-empty">No visit</span>;
  return (
    <span className={`pit-summary quality-${visit.quality}`} title={`Pit visit quality: ${visit.quality}`}>
      <span className="pit-summary-totals">
        <span><small>Lane</small>{formatSeconds(visit.pitLaneTime)}</span>
        <span className={visit.inferredBoxTime > 0 ? "contains-inference" : ""}><small>Box</small>{visit.inferredBoxTime > 0 ? "~" : ""}{formatSeconds(visit.boxTime)}</span>
        <span className={visit.unknownTime > 0 ? "contains-unknown" : ""}><small>Unknown</small>{formatSeconds(visit.unknownTime)}</span>
      </span>
      {visit.driverChange && <strong>Driver change</strong>}
    </span>
  );
}

function sectorValue(sector: CompletedSector) {
  const unavailable = sector.value == null || sector.quality === "invalid" || sector.quality === "incomplete";
  const marker = sector.quality === "inferred" ? "~" : "";
  const fastest = sector.quality === "valid" && sector.comparisons?.includes("overall-fastest");
  const personal = sector.quality === "valid" && sector.comparisons?.includes("personal-best");
  const title = `${sector.source} · ${sector.quality}${sector.reason ? ` · ${sector.reason.replaceAll("-", " ")}` : ""} · ${sector.definitionRevision}`;
  return <span key={`${sector.lapNumber}-${sector.sectorNumber}`} className={`sector-time${fastest ? " is-overall-fastest" : personal ? " is-personal-best" : ""}`} title={title}><small>S{sector.sectorNumber}</small>{unavailable ? "--" : `${marker}${sector.value!.toFixed(3)}`}</span>;
}

function sectorSummary(driver: DriverState) {
  if (!Object.hasOwn(driver, "sectors")) return <span className="sector-empty" title="This producer does not report derived sectors">--</span>;
  const sectors = driver.sectors?.previousLap ?? [];
  if (sectors.length === 0) return <span className="sector-empty">--</span>;
  return <span className="sector-summary">{sectors.map(sectorValue)}</span>;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${Math.floor(safeSeconds % 60).toString().padStart(2, "0")}`;
}

function stintSummary(stint: DriverStintSummary | undefined) {
  if (!stint) return <span className="stint-summary is-empty">--</span>;
  const marker = stint.quality === "inferred" ? "~" : stint.quality === "invalid" || stint.quality === "incomplete" ? "?" : "";
  return <span className={`stint-summary quality-${stint.quality}`} title={`${stint.changeContext ?? "current driver"} · ${stint.quality}`}><strong>{marker}{formatDuration(stint.duration)}</strong><small>{stint.lapCount} laps{stint.previousDriverName ? ` · from ${stint.previousDriverName}` : ""}</small></span>;
}

function qualityWarnings(driver: DriverState): string[] {
  if (!driver.timingQuality) return ["Timing quality metadata not reported"];
  return Object.entries(driver.timingQuality)
    .filter(([, quality]) => quality && quality.quality !== "valid")
    .map(([field, quality]) => `${field}: ${qualityLabel(quality)}`);
}

function PitVisitDetail({ driver }: { driver: DriverState }) {
  const visit = driver.latestPitVisit;
  const pitSummarySupported = Object.hasOwn(driver, "latestPitVisit");
  const warnings = qualityWarnings(driver);
  return (
    <div className="commentator-detail-grid">
      <section>
        <span className="detail-kicker">Pit visit supplied by server</span>
        {visit ? (
          <dl className="pit-detail-list">
            <div><dt>Entry</dt><dd>{formatSeconds(visit.pitEntryTime)}</dd></div>
            <div><dt>Exit</dt><dd>{visit.pitExitTime == null ? "Open visit" : formatSeconds(visit.pitExitTime)}</dd></div>
            <div><dt>Lane total</dt><dd>{formatSeconds(visit.pitLaneTime)}</dd></div>
            <div><dt>Box total</dt><dd>{formatSeconds(visit.boxTime)}</dd></div>
            <div><dt>Observed box</dt><dd>{formatSeconds(visit.observedBoxTime)}</dd></div>
            <div><dt>Inferred box</dt><dd>{formatSeconds(visit.inferredBoxTime)}</dd></div>
            <div><dt>Unknown</dt><dd>{formatSeconds(visit.unknownTime)}</dd></div>
            <div><dt>Driver change</dt><dd>{visit.driverChange ? "Yes" : "No"}</dd></div>
          </dl>
        ) : <p>{pitSummarySupported ? "No pit visit has been reported for this car." : "This telemetry producer does not support pit-visit summaries."}</p>}
      </section>
      <section>
        <span className="detail-kicker">Timing confidence</span>
        {warnings.length > 0 ? <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>All reported timing fields are valid.</p>}
      </section>
    </div>
  );
}

export function CommentatorTimingTable({
  drivers,
  selectedCarIdx,
  nearbyCarIdxs,
  expandedCarIdxs,
  visibleColumns,
  groupByClass,
  stints = [],
  gapTrends = [],
  pitCycles = [],
  onSelectCar,
  onToggleExpanded,
}: CommentatorTimingTableProps) {
  let previousClassId: number | null = null;
  const columnCount = 2 + visibleColumns.size;

  return (
    <div className="commentator-table-wrap">
      <table className="commentator-table">
        <thead><tr>
          <th className="position-column">Position</th>
          <th className="driver-column">Driver / team</th>
          {visibleColumns.has("change") && <th>Change</th>}
          {visibleColumns.has("lap") && <th>Lap</th>}
          {visibleColumns.has("gap") && <th>Gap <small>overall / class</small></th>}
          {visibleColumns.has("interval") && <th>Interval <small>overall / class</small></th>}
          {visibleColumns.has("lapTimes") && <th>Lap times <small>last / best</small></th>}
          {visibleColumns.has("sectors") && <th>Sectors <small>previous lap</small></th>}
          {visibleColumns.has("stint") && <th>Stint <small>time / laps</small></th>}
          {visibleColumns.has("pit") && <th>Pit visit</th>}
          {visibleColumns.has("status") && <th>Status</th>}
        </tr></thead>
        <tbody>
          {drivers.map((driver) => {
            const showClassHeader = groupByClass && driver.classId !== previousClassId;
            previousClassId = driver.classId;
            const selected = driver.carIdx === selectedCarIdx;
            const nearby = nearbyCarIdxs.has(driver.carIdx);
            const expanded = expandedCarIdxs.has(driver.carIdx);
            const status = driverStatus(driver);
            const stint = stints.find((candidate) => candidate.carIdx === driver.carIdx);
            const trend = gapTrends.find((candidate) => candidate.chasingCarIdx === driver.carIdx && candidate.quality === "valid");
            const pitCycle = pitCycles.find((candidate) => candidate.carIdx === driver.carIdx);
            return [
              showClassHeader ? (
                <tr className="class-divider" key={`class-${driver.classId}`} style={{ "--class-color": driver.classColor } as CSSProperties}>
                  <th colSpan={columnCount}><i />{driver.className}<span>{drivers.filter((candidate) => candidate.classId === driver.classId).length} cars</span></th>
                </tr>
              ) : null,
              <tr
                key={driver.carIdx}
                className={`${selected ? "is-selected" : ""}${nearby ? " is-nearby" : ""}`}
                onClick={() => onSelectCar(driver.carIdx)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectCar(driver.carIdx);
                }}
                tabIndex={0}
                aria-label={`Follow ${driver.name}, class position ${driver.classPosition}`}
                aria-current={selected ? "true" : undefined}
              >
                <td className="position-cell"><button type="button" className="expand-control" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} timing detail for ${driver.name}`} onClick={(event) => { event.stopPropagation(); onToggleExpanded(driver.carIdx); }}>{expanded ? <ChevronDown /> : <ChevronRight />}</button><span><strong>{driver.position}</strong><small>C{driver.classPosition}</small></span></td>
                <td className="driver-cell"><span className="commentator-car-number" style={{ "--class-color": driver.classColor } as CSSProperties}>{driver.carNumber}</span><span><strong>{driver.name}</strong><small>{driver.team} · {driver.className}</small></span></td>
                {visibleColumns.has("change") && <td className="change-cell"><span>{positionDelta(driver.positionChange)}<small>overall</small></span><span>{positionDelta(driver.classPositionChange)}<small>class</small></span></td>}
                {visibleColumns.has("lap") && <td className="lap-cell"><strong>L{driver.currentLap}</strong>{qualityValue(driver.lapDistPct, timingQuality(driver, "lapDistPct"), (value) => `${Math.round(value * 100)}%`)}</td>}
                {visibleColumns.has("gap") && <td className="paired-value"><span>{gapValue(driver, false)}<small>overall</small></span><span>{gapValue(driver, true)}<small>class{trend?.direction ? ` · ${trend.direction}` : ""}</small></span></td>}
                {visibleColumns.has("interval") && <td className="paired-value"><span>{intervalValue(driver, false)}<small>overall</small></span><span>{intervalValue(driver, true)}<small>class</small></span></td>}
                {visibleColumns.has("lapTimes") && <td className="paired-value"><span>{lapTimeValue(driver, "lastLap")}<small>last</small></span><span>{lapTimeValue(driver, "bestLap")}<small>best</small></span></td>}
                {visibleColumns.has("sectors") && <td>{sectorSummary(driver)}</td>}
                {visibleColumns.has("stint") && <td>{stintSummary(stint)}</td>}
                {visibleColumns.has("pit") && <td>{pitVisitSummary(driver)}</td>}
                {visibleColumns.has("status") && <td><span className={`commentator-status status-${driver.pitState ?? driver.trackStatus}`}>{status}</span></td>}
              </tr>,
              expanded ? <tr className="commentator-detail-row" key={`detail-${driver.carIdx}`}><td colSpan={columnCount}><div className="expanded-intelligence"><PitVisitDetail driver={driver} /><section><span className="detail-kicker">Race intelligence</span><dl><div><dt>Current stint</dt><dd>{stint ? `${formatDuration(stint.duration)} · ${stint.lapCount} laps` : "Unavailable"}</dd></div><div><dt>Previous driver</dt><dd>{stint?.previousDriverName ?? "Unavailable"}</dd></div><div><dt>Pit cycle</dt><dd>{pitCycle ? `${pitCycle.stopCount} stops · ${formatSeconds(pitCycle.totalBoxTime)} box` : "Unavailable"}</dd></div><div><dt>Gap trend</dt><dd>{trend?.direction ?? "Insufficient clean history"}</dd></div></dl></section></div></td></tr> : null,
            ];
          })}
        </tbody>
      </table>
      {drivers.length === 0 && <div className="timing-empty">No cars are reported in this class.</div>}
    </div>
  );
}
