import {
  formatLapTime,
  type DriverState,
  type DriverStintSummary,
  type DriverTimingField,
  type GapTrend,
  type PitCycleSummary,
  type PitStopSummary,
  type CompletedSector,
  type CompletedLap,
  type TimingQualityMetadata,
  isExpectedUnavailableTimingField,
} from "@racecontrol/protocol";
import React from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { RefreshCw } from "lucide-react";
import type { RecentLapHistoryResource } from "./use-gap-history";

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

export function sortByOverallPosition(drivers: DriverState[]): DriverState[] {
  return [...drivers].sort((left, right) =>
    sortablePosition(left.position) - sortablePosition(right.position)
      || sortablePosition(left.classPosition) - sortablePosition(right.classPosition)
      || left.carIdx - right.carIdx);
}

export interface CommentatorTimingTableProps {
  drivers: DriverState[];
  overallFastestCarIdx?: number;
  expandedCarIdxs: ReadonlySet<number>;
  visibleColumns: ReadonlySet<CommentatorColumn>;
  groupByClass: boolean;
  showClassGaps?: boolean;
  stints?: DriverStintSummary[];
  gapTrends?: GapTrend[];
  pitCycles?: PitCycleSummary[];
  pitStops?: PitStopSummary[];
  lapHistoryByCarIdx?: ReadonlyMap<number, RecentLapHistoryResource>;
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

function lapTimeState(driver: DriverState, field: "lastLap" | "bestLap", overallFastestCarIdx?: number) {
  const value = driver[field];
  const quality = timingQuality(driver, field)?.quality;
  const available = value != null && Number.isFinite(value) && value > 0 && quality !== "invalid" && quality !== "incomplete";
  const personalBest = available && (field === "bestLap" || (driver.lastLapNumber != null && driver.lastLapNumber === driver.bestLapNumber));
  const overallFastest = personalBest && driver.carIdx === overallFastestCarIdx;
  return {
    className: overallFastest ? "is-overall-fastest" : personalBest ? "is-personal-best" : "",
    label: overallFastest ? `${field === "lastLap" ? "last" : "best"} · fastest` : personalBest ? `${field === "lastLap" ? "last" : "best"} · PB` : field === "lastLap" ? "last" : "best",
    title: overallFastest ? "Overall fastest lap" : personalBest ? "Personal best lap" : undefined,
  };
}

function totalPitVisitTime(visit: Pick<PitStopSummary, "pitLaneTime" | "boxTime" | "unknownTime">): number {
  return visit.pitLaneTime + visit.boxTime + visit.unknownTime;
}

function pitVisitSummary(driver: DriverState, pitStop: PitStopSummary | undefined) {
  const visit = driver.latestPitVisit;
  if (!Object.hasOwn(driver, "latestPitVisit")) return <span className="pit-summary is-empty" title="This producer does not report pit summaries">--</span>;
  if (!visit) return <span className="pit-summary is-empty">No visit</span>;
  return (
    <span className={`pit-summary quality-${visit.quality}`} title={`Pit visit quality: ${visit.quality}`}>
      <span className="pit-summary-totals">
        <span><small>Lane</small>{formatSeconds(visit.pitLaneTime)}</span>
        <span className={visit.inferredBoxTime > 0 ? "contains-inference" : ""}><small>Box</small>{visit.inferredBoxTime > 0 ? "~" : ""}{formatSeconds(visit.boxTime)}</span>
        <span><small>Lap</small>{pitStop ? `L${pitStop.pitLap}` : "--"}</span>
        <span className={visit.unknownTime > 0 ? "contains-unknown" : ""} title={visit.unknownTime > 0 ? `${formatSeconds(visit.unknownTime)} unresolved time included` : undefined}><small>Total</small>{formatSeconds(totalPitVisitTime(visit))}</span>
        {visit.driverChange && <span className="pit-driver-change" title="Driver change"><RefreshCw aria-label="Driver change" /></span>}
      </span>
    </span>
  );
}

function sectorValue(sector: CompletedSector | undefined) {
  if (!sector) return <span className="sector-time is-empty">--</span>;
  const unavailable = sector.value == null || sector.quality === "invalid" || sector.quality === "incomplete";
  const marker = sector.quality === "inferred" ? "~" : "";
  const fastest = sector.quality === "valid" && sector.comparisons?.includes("overall-fastest");
  const personal = sector.quality === "valid" && sector.comparisons?.includes("personal-best");
  const title = `${sector.source} · ${sector.quality}${sector.reason ? ` · ${sector.reason.replaceAll("-", " ")}` : ""} · ${sector.definitionRevision}`;
  return <span className={`sector-time${fastest ? " is-overall-fastest" : personal ? " is-personal-best" : ""}`} title={title}>{unavailable ? "--" : `${marker}${sector.value!.toFixed(3)}`}</span>;
}

function sectorColumnSummary(driver: DriverState, sectorNumber: number) {
  const supported = Object.hasOwn(driver, "sectors");
  const current = driver.sectors?.currentLap?.find((sector) => sector.sectorNumber === sectorNumber);
  const previous = driver.sectors?.previousLap?.find((sector) => sector.sectorNumber === sectorNumber);
  const best = driver.sectors?.bestSectors?.find((sector) => sector.sectorNumber === sectorNumber);
  return (
    <span className="sector-column-summary" title={supported ? undefined : "This producer does not report derived sectors"}>
      <span>{sectorValue(current)}</span>
      <span>{sectorValue(previous)}</span>
      <span>{sectorValue(best)}</span>
    </span>
  );
}

function sectorNumbersForDrivers(drivers: DriverState[]): number[] {
  return [...new Set(drivers.flatMap((driver) => [
    ...(driver.sectors?.currentLap ?? []),
    ...(driver.sectors?.previousLap ?? []),
    ...(driver.sectors?.bestSectors ?? []),
  ].map((sector) => sector.sectorNumber)))].sort((left, right) => left - right);
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${Math.floor(safeSeconds % 60).toString().padStart(2, "0")}`;
}

function stintSummary(stint: DriverStintSummary | undefined) {
  if (!stint) return <span className="stint-summary is-empty">--</span>;
  const marker = stint.quality === "inferred" ? "~" : stint.quality === "invalid" || stint.quality === "incomplete" ? "?" : "";
  const previousDriver = stint.previousDriverName ? ` · from ${stint.previousDriverName}` : "";
  return <span className={`stint-summary quality-${stint.quality}`} title={`${stint.lapCount} laps${previousDriver} · ${stint.changeContext ?? "current driver"} · ${stint.quality}`}><strong>{marker}{formatDuration(stint.duration)}</strong><small>{stint.lapCount} laps</small></span>;
}

function qualityWarnings(driver: DriverState): string[] {
  if (!driver.timingQuality) return ["Timing quality metadata not reported"];
  return Object.entries(driver.timingQuality)
    .filter(([field, quality]) => quality && quality.quality !== "valid" && !isExpectedUnavailableTimingField(driver, field))
    .map(([field, quality]) => `${field}: ${qualityLabel(quality)}`);
}

function lapGapLabel(lap: CompletedLap): string {
  if ((lap.lapsBehindClassLeader ?? 0) > 0) return `+${lap.lapsBehindClassLeader}L`;
  if (lap.classPosition === 1) return "Leader";
  return lap.gapToClassLeader == null ? "--" : `+${lap.gapToClassLeader.toFixed(3)}`;
}

function lapGapPath(laps: CompletedLap[]): string {
  const numeric = laps.filter((lap) => lap.gapToClassLeader != null && (lap.lapsBehindClassLeader ?? 0) === 0);
  const maxGap = Math.max(1, ...numeric.map((lap) => lap.gapToClassLeader!));
  let drawing = false;
  return laps.map((lap, index) => {
    if (lap.gapToClassLeader == null || (lap.lapsBehindClassLeader ?? 0) > 0) {
      drawing = false;
      return "";
    }
    const x = laps.length === 1 ? 260 : 8 + (index / (laps.length - 1)) * 504;
    const y = 6 + (lap.gapToClassLeader / maxGap) * 42;
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function LapGapHistory({ resource }: { resource: RecentLapHistoryResource | undefined }) {
  if (!resource || resource.loading) return <p>Loading the latest completed-lap gaps…</p>;
  if (resource.error) return <p className="lap-gap-error">{resource.error}</p>;
  if (resource.laps.length === 0) return <p>No completed-lap gap history has been recorded for this car.</p>;
  return <div className="lap-gap-history">
    <svg viewBox="0 0 520 54" preserveAspectRatio="none" aria-hidden="true"><line x1="8" x2="512" y1="48" y2="48" /><path d={lapGapPath(resource.laps)} /></svg>
    <div className="lap-gap-values">{resource.laps.map((lap) => <span key={lap.lapNumber}><small>L{lap.lapNumber}</small><strong>{lapGapLabel(lap)}</strong></span>)}</div>
  </div>;
}

function PitVisitDetail({ driver, pitStops, lapHistory }: { driver: DriverState; pitStops: PitStopSummary[]; lapHistory?: RecentLapHistoryResource }) {
  const visit = driver.latestPitVisit;
  const pitSummarySupported = Object.hasOwn(driver, "latestPitVisit");
  const warnings = qualityWarnings(driver);
  const orderedStops = pitStops
    .filter((stop) => stop.carIdx === driver.carIdx)
    .sort((left, right) => right.pitEntryTime - left.pitEntryTime);
  return (
    <div className="commentator-detail-grid">
      <section>
        <span className="detail-kicker">Race pit-stop history</span>
        {orderedStops.length > 0 ? (
          <div className="pit-history-wrap">
            <div className="pit-history-table" role="table" aria-label={`${driver.name} pit-stop history`}>
              <div className="pit-history-head" role="row"><span role="columnheader">Stop</span><span role="columnheader">Lap</span><span role="columnheader">Entry</span><span role="columnheader">Lane</span><span role="columnheader">Stationary</span><span role="columnheader">Driver change</span></div>
              {orderedStops.map((stop, index) => (
                <div key={stop.pitEntryTime} className={`pit-history-row quality-${stop.quality}`} role="row" title={`Pit-stop timing quality: ${stop.quality}`}>
                  <span role="cell">#{orderedStops.length - index}{stop.pitExitTime == null && <small>Open</small>}</span>
                  <span role="cell">L{stop.pitLap}</span>
                  <span role="cell">{formatSeconds(stop.pitEntryTime)}</span>
                  <span role="cell">{formatSeconds(stop.pitLaneTime)}</span>
                  <span role="cell" className={stop.inferredBoxTime > 0 ? "contains-inference" : ""}>{stop.inferredBoxTime > 0 ? "~" : ""}{formatSeconds(stop.boxTime)}{stop.unknownTime > 0 && <small>{formatSeconds(stop.unknownTime)} unknown</small>}</span>
                  <span role="cell">{stop.driverChange ? <><strong>{stop.exitDriverName ?? "Driver not identified"}</strong><small>in{stop.entryDriverName ? ` · from ${stop.entryDriverName}` : ""}</small></> : <span className="no-driver-change">No change</span>}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <p>{pitSummarySupported ? (visit ? "Pit history is waiting for race intelligence." : "No pit stop has been reported for this car.") : "This telemetry producer does not support pit-stop summaries."}</p>}
      </section>
      <section>
        <span className="detail-kicker">Last 10 lap gaps · seconds to class leader</span>
        <LapGapHistory resource={lapHistory} />
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
  overallFastestCarIdx,
  expandedCarIdxs,
  visibleColumns,
  groupByClass,
  showClassGaps = new Set(drivers.map((driver) => driver.classId)).size > 1,
  stints = [],
  gapTrends = [],
  pitCycles = [],
  pitStops = [],
  lapHistoryByCarIdx = new Map(),
  onToggleExpanded,
}: CommentatorTimingTableProps) {
  let previousClassId: number | null = null;
  const sectorNumbers = sectorNumbersForDrivers(drivers);
  const visibleSectorNumbers = sectorNumbers.length > 0 ? sectorNumbers : [1];
  const baseColumnCount = [...visibleColumns].filter((column) => column !== "sectors" && (showClassGaps || (column !== "gap" && column !== "interval"))).length;
  const columnCount = 2 + baseColumnCount + (visibleColumns.has("sectors") ? visibleSectorNumbers.length : 0);

  return (
    <div className="commentator-table-wrap" style={{ "--sector-count": visibleColumns.has("sectors") ? visibleSectorNumbers.length : 0 } as CSSProperties}>
      <table className="commentator-table">
        <thead><tr>
          <th className="position-column">Position</th>
          <th className="driver-column">Driver / team</th>
          {visibleColumns.has("change") && <th className="change-column">Change</th>}
          {visibleColumns.has("lap") && <th className="lap-column">Lap</th>}
          {showClassGaps && visibleColumns.has("gap") && <th className="gap-column">Class gap <small>to class leader</small></th>}
          {showClassGaps && visibleColumns.has("interval") && <th className="interval-column">Class interval <small>to car ahead</small></th>}
          {visibleColumns.has("lapTimes") && <th className="lap-times-column">Lap times <small>last / best</small></th>}
          {visibleColumns.has("sectors") && visibleSectorNumbers.map((sectorNumber) => <th className="sector-column" key={sectorNumber}>Sector {sectorNumber}<small className="sector-column-head"><span>Current</span><span>Prev</span><span>Best</span></small></th>)}
          {visibleColumns.has("stint") && <th className="stint-column">Stint <small>time / laps</small></th>}
          {visibleColumns.has("pit") && <th className="pit-column">Pit visit <small>lane / box / lap / total</small></th>}
          {visibleColumns.has("status") && <th className="status-column">Status</th>}
        </tr></thead>
        <tbody>
          {drivers.map((driver) => {
            const showClassHeader = groupByClass && driver.classId !== previousClassId;
            previousClassId = driver.classId;
            const expanded = expandedCarIdxs.has(driver.carIdx);
            const status = driverStatus(driver);
            const stint = stints.find((candidate) => candidate.carIdx === driver.carIdx);
            const trend = gapTrends.find((candidate) => candidate.chasingCarIdx === driver.carIdx && candidate.quality === "valid");
            const pitCycle = pitCycles.find((candidate) => candidate.carIdx === driver.carIdx);
            const latestPitStop = pitStops
              .filter((candidate) => candidate.carIdx === driver.carIdx)
              .sort((left, right) => right.pitEntryTime - left.pitEntryTime)[0];
            const lastLapState = lapTimeState(driver, "lastLap", overallFastestCarIdx);
            const bestLapState = lapTimeState(driver, "bestLap", overallFastestCarIdx);
            return [
              showClassHeader ? (
                <tr className="class-divider" key={`class-${driver.classId}`} style={{ "--class-color": driver.classColor } as CSSProperties}>
                  <th colSpan={columnCount}><i />{driver.className}<span>{drivers.filter((candidate) => candidate.classId === driver.classId).length} cars</span></th>
                </tr>
              ) : null,
              <tr
                key={driver.carIdx}
              >
                <td className="position-cell" aria-expanded={expanded} title={`${expanded ? "Hide" : "Show"} timing detail`} onClick={() => onToggleExpanded(driver.carIdx)}><span><strong>{driver.position}</strong><small className="class-position" style={{ "--class-color": driver.classColor } as CSSProperties}>C{driver.classPosition}</small></span></td>
                <td className="driver-cell"><span className="commentator-car-number" style={{ "--class-color": driver.classColor } as CSSProperties}>{driver.carNumber}</span><span><strong>{driver.name}</strong><small><span className="team-name">{driver.team}</span><span className="driver-class-name">{driver.className}</span></small></span></td>
                {visibleColumns.has("change") && <td className="change-cell"><span>{positionDelta(driver.positionChange)}<small>overall</small></span><span>{positionDelta(driver.classPositionChange)}<small>class</small></span></td>}
                {visibleColumns.has("lap") && <td className="lap-cell"><strong>L{driver.currentLap}</strong>{qualityValue(driver.lapDistPct, timingQuality(driver, "lapDistPct"), (value) => `${Math.round(value * 100)}%`)}</td>}
                {showClassGaps && visibleColumns.has("gap") && <td className="single-value"><span>{gapValue(driver, true)}<small>{trend?.direction ?? "class"}</small></span></td>}
                {showClassGaps && visibleColumns.has("interval") && <td className="single-value"><span>{intervalValue(driver, true)}<small>class</small></span></td>}
                {visibleColumns.has("lapTimes") && <td className="paired-value lap-time-pair"><span className={lastLapState.className} title={lastLapState.title}>{lapTimeValue(driver, "lastLap")}<small>{lastLapState.label}</small></span><span className={bestLapState.className} title={bestLapState.title}>{lapTimeValue(driver, "bestLap")}<small>{bestLapState.label}</small></span></td>}
                {visibleColumns.has("sectors") && visibleSectorNumbers.map((sectorNumber) => <td className="sector-cell" key={sectorNumber}>{sectorColumnSummary(driver, sectorNumber)}</td>)}
                {visibleColumns.has("stint") && <td className="stint-cell">{stintSummary(stint)}</td>}
                {visibleColumns.has("pit") && <td className="pit-cell">{pitVisitSummary(driver, latestPitStop)}</td>}
                {visibleColumns.has("status") && <td><span className={`commentator-status status-${driver.pitState ?? driver.trackStatus}`}>{status}</span></td>}
              </tr>,
              expanded ? <tr className="commentator-detail-row" key={`detail-${driver.carIdx}`}><td colSpan={columnCount}><div className="expanded-intelligence"><PitVisitDetail driver={driver} pitStops={pitStops} lapHistory={lapHistoryByCarIdx.get(driver.carIdx)} /><section><span className="detail-kicker">Race intelligence</span><dl><div><dt>Current stint</dt><dd>{stint ? `${formatDuration(stint.duration)} · ${stint.lapCount} laps` : "Unavailable"}</dd></div><div><dt>Previous stint</dt><dd>{stint?.recentCompleted ? `${stint.recentCompleted.driverName} · ${formatDuration(stint.recentCompleted.duration)} · ${stint.recentCompleted.lapCount} laps` : stint?.previousDriverName ?? "Unavailable"}</dd></div><div><dt>Pit cycle</dt><dd>{pitCycle ? `${pitCycle.stopCount} stops · ${formatSeconds(pitCycle.totalBoxTime)} box` : "Unavailable"}</dd></div><div><dt>Gap trend</dt><dd>{trend?.direction ?? "Insufficient clean history"}</dd></div></dl></section></div></td></tr> : null,
            ];
          })}
        </tbody>
      </table>
      {drivers.length === 0 && <div className="timing-empty">No cars are reported in this class.</div>}
    </div>
  );
}
