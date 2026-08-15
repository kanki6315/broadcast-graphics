import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CarClassState, ClassGapHistoryDriver, ClassGapHistoryPoint, ClassGapHistoryResponse } from "@racecontrol/protocol";
import { X } from "lucide-react";

const lineColors = ["#e0a900", "#069dcc", "#ff4b21", "#ef3e72", "#138f86", "#9350cf", "#187fd1", "#68706d", "#9a6514", "#a22b23"];
const viewWidth = 1140;
const viewHeight = 500;
const plot = { left: 110, right: 850, top: 42, bottom: 450 };

interface GapVisualizerProps {
  history: ClassGapHistoryResponse | null;
  classes: CarClassState[];
  loading: boolean;
  error: string | null;
  onSelectClass: (classId: number) => void;
  onClose: () => void;
}

function byDriver(points: ClassGapHistoryPoint[]): Map<number, ClassGapHistoryPoint[]> {
  const grouped = new Map<number, ClassGapHistoryPoint[]>();
  for (const point of points) grouped.set(point.carIdx, [...(grouped.get(point.carIdx) ?? []), point]);
  return grouped;
}

export function downsampleGapPoints(points: ClassGapHistoryPoint[], maximumPoints = 800): ClassGapHistoryPoint[] {
  if (points.length <= maximumPoints) return points;
  const stride = Math.ceil(points.length / maximumPoints);
  const selected = new Set<number>([0, points.length - 1]);
  for (let index = 0; index < points.length; index += stride) selected.add(index);
  for (let index = 1; index < points.length; index++) {
    const previousValid = points[index - 1]!.gapToClassLeader != null && (points[index - 1]!.lapsBehindClassLeader ?? 0) === 0;
    const valid = points[index]!.gapToClassLeader != null && (points[index]!.lapsBehindClassLeader ?? 0) === 0;
    if (valid !== previousValid) {
      selected.add(index - 1);
      selected.add(index);
    }
  }
  return [...selected].sort((left, right) => left - right).map((index) => points[index]!);
}

function driverOrder(driver: ClassGapHistoryDriver, grouped: ReadonlyMap<number, ClassGapHistoryPoint[]>): number {
  return grouped.get(driver.carIdx)?.at(-1)?.classPosition ?? Number.MAX_SAFE_INTEGER;
}

function tickValues(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const values = Array.from({ length: count }, (_, index) => Math.round(min + ((max - min) * index) / (count - 1)));
  return [...new Set(values)];
}

function linePath(
  points: ClassGapHistoryPoint[],
  x: (lap: number) => number,
  y: (gap: number) => number,
): string {
  let drawing = false;
  return points.map((point) => {
    const valid = point.gapToClassLeader != null && (point.lapsBehindClassLeader ?? 0) === 0;
    if (!valid) {
      drawing = false;
      return "";
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${x(point.lapNumber).toFixed(1)},${y(point.gapToClassLeader!).toFixed(1)}`;
  }).join(" ");
}

export function GapVisualizer({ history, classes, loading, error, onSelectClass, onClose }: GapVisualizerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [isolatedCarIdx, setIsolatedCarIdx] = useState<number | null>(null);
  const [hoverLap, setHoverLap] = useState<number | null>(null);
  const allLaps = history?.points.map((point) => point.lapNumber) ?? [];
  const recordedMin = allLaps.length > 0 ? Math.min(...allLaps) : 1;
  const recordedMax = allLaps.length > 0 ? Math.max(...allLaps) : 1;
  const [windowStart, setWindowStart] = useState(recordedMin);
  const [windowEnd, setWindowEnd] = useState(recordedMax);

  useEffect(() => {
    setWindowStart(recordedMin);
    setWindowEnd(recordedMax);
    setIsolatedCarIdx(null);
    setHoverLap(null);
  }, [history?.sessionId, history?.classId, recordedMin, recordedMax]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const grouped = useMemo(() => byDriver(history?.points ?? []), [history?.points]);
  const drivers = useMemo(() => [...(history?.drivers ?? [])].sort((left, right) => driverOrder(left, grouped) - driverOrder(right, grouped) || left.carIdx - right.carIdx), [grouped, history?.drivers]);
  const visiblePoints = useMemo(() => (history?.points ?? []).filter((point) => point.lapNumber >= windowStart && point.lapNumber <= windowEnd), [history?.points, windowEnd, windowStart]);
  const visibleGrouped = useMemo(() => byDriver(visiblePoints), [visiblePoints]);
  const numericGaps = visiblePoints.flatMap((point) => point.gapToClassLeader == null || (point.lapsBehindClassLeader ?? 0) > 0 ? [] : [point.gapToClassLeader]);
  const maxGap = Math.max(10, Math.ceil((Math.max(0, ...numericGaps) + 1) / 10) * 10);
  const x = (lap: number) => plot.left + ((lap - windowStart) / Math.max(1, windowEnd - windowStart)) * (plot.right - plot.left);
  const y = (gap: number) => plot.top + (gap / maxGap) * (plot.bottom - plot.top);
  const inspectingLap = hoverLap ?? windowEnd;
  const selectedClass = classes.find((candidate) => candidate.id === history?.classId);

  function inspect(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - bounds.left) / bounds.width) * viewWidth;
    const ratio = Math.max(0, Math.min(1, (localX - plot.left) / (plot.right - plot.left)));
    setHoverLap(Math.round(windowStart + ratio * (windowEnd - windowStart)));
  }

  return (
    <div className="gap-visualizer-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="gap-visualizer" role="dialog" aria-modal="true" aria-labelledby="gap-visualizer-title" tabIndex={-1} ref={dialogRef}>
        <header>
          <div><h2 id="gap-visualizer-title">Gap visualizer</h2><p>{selectedClass?.name ?? "Class"} · Full recorded session history</p></div>
          <div className="gap-visualizer-status"><strong>History through lap {recordedMax}</strong><span>Frozen snapshot</span></div>
          <button onClick={onClose} aria-label="Close gap visualizer"><X aria-hidden="true" /></button>
        </header>
        <div className="gap-visualizer-toolbar">
          <div className="gap-class-filter" role="group" aria-label="Gap visualizer class">
            {classes.map((carClass) => <button key={carClass.id} className={carClass.id === history?.classId ? "is-selected" : ""} onClick={() => onSelectClass(carClass.id)}>{carClass.name}</button>)}
          </div>
          <span>Recorded L{recordedMin}–L{recordedMax}</span><span>Reference: class leader</span>
        </div>
        {loading && !history && <div className="gap-visualizer-message"><strong>Loading full class history</strong><span>Collecting completed scoring-line gaps.</span></div>}
        {!loading && !history && <div className="gap-visualizer-message is-error"><strong>History unavailable</strong><span>{error ?? "No recorded laps are available for this class."}</span></div>}
        {history && history.points.length === 0 && <div className="gap-visualizer-message"><strong>No completed-lap gaps recorded</strong><span>The visualizer will be available after scoring-line history is stored.</span></div>}
        {history && history.points.length > 0 && <>
          <div className="gap-chart-wrap">
            <svg className="gap-chart" viewBox={`0 0 ${viewWidth} ${viewHeight}`} onPointerMove={inspect} onPointerLeave={() => setHoverLap(null)} aria-label={`Gap history for ${selectedClass?.name ?? "selected class"}`}>
              <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} className="gap-chart-field" />
              {tickValues(0, maxGap, 7).map((gap) => <g key={gap}><line x1={plot.left} x2={plot.right} y1={y(gap)} y2={y(gap)} className="gap-chart-grid" /><text x={plot.left - 12} y={y(gap) + 4} textAnchor="end">{gap === 0 ? "LEADER 0.0s" : `+${gap}s`}</text></g>)}
              {tickValues(windowStart, windowEnd, 9).map((lap) => <g key={lap}><line x1={x(lap)} x2={x(lap)} y1={plot.top} y2={plot.bottom} className="gap-chart-grid" /><text x={x(lap)} y={plot.bottom + 24} textAnchor="middle">L{lap}</text></g>)}
              {drivers.map((driver, index) => {
                const color = lineColors[index % lineColors.length]!;
                const points = downsampleGapPoints(visibleGrouped.get(driver.carIdx) ?? []);
                const latest = points.at(-1);
                const dimmed = isolatedCarIdx != null && isolatedCarIdx !== driver.carIdx;
                const labelY = plot.top + (index / Math.max(1, drivers.length - 1)) * (plot.bottom - plot.top);
                const lapDeficit = latest?.lapsBehindClassLeader ?? 0;
                const value = lapDeficit > 0 ? `+${lapDeficit}L` : latest?.gapToClassLeader == null ? "--" : latest.classPosition === 1 ? "LEADER" : `+${latest.gapToClassLeader.toFixed(3)}s`;
                const teamLabel = driver.team.length > 12 ? `${driver.team.slice(0, 12)}…` : driver.team;
                return <g key={driver.carIdx} className={dimmed ? "is-dimmed" : ""}>
                  <path d={linePath(points, x, y)} style={{ stroke: color }} className="gap-driver-line" />
                  <line x1={plot.right} x2={plot.right + 18} y1={latest?.gapToClassLeader != null && lapDeficit === 0 ? y(latest.gapToClassLeader) : labelY} y2={labelY} style={{ stroke: color }} className="gap-label-leader" />
                  <g className="gap-driver-label" role="button" tabIndex={0} onClick={() => setIsolatedCarIdx((current) => current === driver.carIdx ? null : driver.carIdx)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setIsolatedCarIdx((current) => current === driver.carIdx ? null : driver.carIdx); }}>
                    <rect x={plot.right + 18} y={labelY - 13} width={260} height={26} />
                    <rect x={plot.right + 18} y={labelY - 13} width={34} height={26} style={{ fill: color }} />
                    <text x={plot.right + 35} y={labelY + 5} textAnchor="middle">P{latest?.classPosition ?? "–"}</text>
                    <text x={plot.right + 60} y={labelY + 5}>#{driver.carNumber} {teamLabel}</text>
                    <text x={plot.right + 268} y={labelY + 5} textAnchor="end">{value}</text>
                  </g>
                </g>;
              })}
              <line x1={x(inspectingLap)} x2={x(inspectingLap)} y1={plot.top} y2={plot.bottom} className="gap-inspection-line" />
              <text x={x(inspectingLap)} y={plot.top - 22} textAnchor="middle" className="gap-inspection-label">Inspecting L{inspectingLap}</text>
            </svg>
          </div>
          <div className="gap-history-range">
            <span>Full history</span>
            <div className="gap-history-track">
              <input aria-label="First displayed lap" type="range" min={recordedMin} max={recordedMax} value={windowStart} onChange={(event) => setWindowStart(Math.min(Number(event.target.value), windowEnd - 1))} />
              <input aria-label="Last displayed lap" type="range" min={recordedMin} max={recordedMax} value={windowEnd} onChange={(event) => setWindowEnd(Math.max(Number(event.target.value), windowStart + 1))} />
            </div>
            <button onClick={() => { setWindowStart(recordedMin); setWindowEnd(recordedMax); }}>Reset zoom</button>
          </div>
        </>}
        {error && history && <p className="gap-visualizer-warning" role="status">{error}</p>}
        <footer><span>Hover the chart to inspect a lap · Select a team to isolate</span><strong>{loading ? "Refreshing before snapshot…" : `Showing L${windowStart}–L${windowEnd}`}</strong></footer>
      </div>
    </div>
  );
}
