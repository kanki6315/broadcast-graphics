import { useEffect, useMemo, useState } from "react";
import type { ClassGapHistoryPoint, ClassGapHistoryResponse, DriverState, PitStopSummary } from "@racecontrol/protocol";
import { timingJson } from "./timing-api";

export function comparisonValue(point: ClassGapHistoryPoint, rival: ClassGapHistoryPoint | undefined, metric: "gap" | "pace"): number | null {
  if (metric === "pace") return rival?.lapTime != null && point.lapTime != null ? point.lapTime - rival.lapTime : null;
  if (point.gapToClassLeader == null || (point.lapsBehindClassLeader ?? 0) > 0) return null;
  if (!rival) return null;
  if (rival.gapToClassLeader == null || (rival.lapsBehindClassLeader ?? 0) > 0) return null;
  return point.gapToClassLeader - rival.gapToClassLeader;
}

export function CarComparison({ driver, drivers, sessionId, pitStops, initialRival }: {
  driver: DriverState; drivers: DriverState[]; sessionId: string; pitStops: PitStopSummary[]; initialRival?: number;
}) {
  const [history, setHistory] = useState<ClassGapHistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [rival, setRival] = useState<string>(initialRival == null ? "leader" : String(initialRival));
  const [metric, setMetric] = useState<"gap" | "pace">("gap");
  const [count, setCount] = useState("25");
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  useEffect(() => { if (initialRival != null) setRival(String(initialRival)); }, [initialRival]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setHistory(null);
    timingJson<ClassGapHistoryResponse>(`/api/history/class-gaps?classId=${driver.classId}`).then((data) => {
      if (cancelled) return;
      if (data.sessionId !== sessionId) throw new Error("The session changed. Reopen this car to load its history.");
      setHistory(data);
      const laps = data.points.filter((point) => point.carIdx === driver.carIdx).map((point) => point.lapNumber);
      setStart(laps.length ? Math.min(...laps) : 1); setEnd(laps.length ? Math.max(...laps) : 1);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "History unavailable"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [driver.classId, driver.carIdx, sessionId, refresh]);
  const rivals = [...new Map([...(history?.drivers ?? []), ...drivers.filter((car) => car.classId === driver.classId)].map((car) => [car.carIdx, car])).values()].filter((car) => car.carIdx !== driver.carIdx);
  const selectedRival = rivals.find((car) => String(car.carIdx) === rival);
  const points = useMemo(() => {
    const all = history?.points ?? [];
    const own = all.filter((point) => point.carIdx === driver.carIdx).sort((a, b) => a.lapNumber - b.lapNumber);
    const comparisons = new Map(all.filter((point) => rival === "leader" ? point.classPosition === 1 : point.carIdx === Number(rival)).map((point) => [point.lapNumber, point]));
    const selected = count === "range" ? own.filter((p) => p.lapNumber >= start && p.lapNumber <= end) : count === "all" ? own : own.slice(-Number(count));
    return selected.map((point) => ({ ...point, value: rival === "leader" && metric === "gap" ? ((point.lapsBehindClassLeader ?? 0) === 0 ? point.gapToClassLeader : null) : comparisonValue(point, comparisons.get(point.lapNumber), metric) }));
  }, [history, driver.carIdx, rival, metric, count, start, end]);
  const valid = points.filter((p) => p.value != null);
  const minimum = Math.min(0, ...valid.map((p) => p.value!));
  const maximum = Math.max(1, ...valid.map((p) => p.value!));
  const firstLap = points[0]?.lapNumber ?? 1, lastLap = points.at(-1)?.lapNumber ?? firstLap;
  const x = (lap: number) => 65 + (lap - firstLap) / Math.max(1, lastLap - firstLap) * 820;
  const y = (value: number) => 165 - (value - minimum) / (maximum - minimum) * 135;
  let previousLap: number | null = null;
  const path = points.map((p) => {
    if (p.value == null) { previousLap = null; return ""; }
    const command = previousLap === p.lapNumber - 1 ? "L" : "M"; previousLap = p.lapNumber;
    return `${command}${x(p.lapNumber)},${y(p.value)}`;
  }).join(" ");
  const first = valid[0], last = valid.at(-1);
  const change = first && last && first !== last ? last.value! - first.value! : null;
  const stops = pitStops.filter((stop) => (stop.carIdx === driver.carIdx || stop.carIdx === Number(rival)) && stop.pitLap >= firstLap && stop.pitLap <= lastLap).sort((a, b) => a.pitLap - b.pitLap);
  return <section className="car-comparison">
    <header><h3>Compare · #{driver.carNumber}</h3><span>{history ? `Recorded through L${Math.max(0, ...history.points.filter((p) => p.carIdx === driver.carIdx).map((p) => p.lapNumber))} · snapshot` : "Completed-lap history"}</span><button onClick={() => setRefresh((n) => n + 1)} disabled={loading}>{loading ? "Loading…" : "Refresh history"}</button></header>
    <div className="comparison-controls">
      <label>Reference<select aria-label="Reference" value={rival} onChange={(e) => setRival(e.target.value)}><option value="leader">Class leader at each lap</option>{rivals.map((car) => <option key={car.carIdx} value={car.carIdx}>#{car.carNumber} · {car.name}</option>)}</select></label>
      <label>Measure<select aria-label="Measure" value={metric} onChange={(e) => setMetric(e.target.value as "gap" | "pace")}><option value="gap">Scoring gap</option><option value="pace">Lap-time difference</option></select></label>
      <label>Laps<select aria-label="Laps" value={count} onChange={(e) => setCount(e.target.value)}>{["10", "25", "50", "all", "range"].map((n) => <option key={n} value={n}>{n === "all" ? "All recorded" : n === "range" ? "Custom range" : `Last ${n}`}</option>)}</select></label>
      {count === "range" && <><label>From<input aria-label="From" type="number" min="1" max={end} value={start} onChange={(e) => setStart(Math.max(1, Math.min(end, Number(e.target.value))))} /></label><label>Through<input aria-label="Through" type="number" min={start} value={end} onChange={(e) => setEnd(Math.max(start, Number(e.target.value)))} /></label></>}
    </div>
    {error ? <p role="alert">{error}</p> : loading ? <p>Loading recorded laps…</p> : points.length === 0 ? <p>No recorded laps in this range.</p> : <>
      <div className="comparison-reading"><strong>{last ? `${last.value! > 0 ? "+" : ""}${last.value!.toFixed(3)}s at L${last.lapNumber}` : "No comparable gaps"}</strong><span>{metric === "gap" ? "Positive = behind; negative = ahead" : "Positive = slower; negative = faster"}{selectedRival ? ` · vs #${selectedRival.carNumber}` : " · vs class leader"}</span>{change != null && metric === "gap" && <span>{Math.abs(change).toFixed(3)}s {change < 0 ? "gained" : "lost"} between L{first!.lapNumber}–L{last!.lapNumber} · includes pit effects</span>}</div>
      <svg className="comparison-chart" viewBox="0 0 920 200" role="img" aria-label={`${metric === "gap" ? "Scoring gap" : "Lap-time difference"} from lap ${firstLap} to ${lastLap}`}>
        {[minimum, (minimum + maximum) / 2, maximum].map((value) => <g key={value}><line x1="65" x2="885" y1={y(value)} y2={y(value)} /><text x="55" y={y(value) + 4} textAnchor="end">{value.toFixed(1)}s</text></g>)}
        <line className="comparison-zero" x1="65" x2="885" y1={y(0)} y2={y(0)} />
        {stops.map((stop, index) => <g key={`${stop.carIdx}:${stop.pitEntryTime}`}><line className="comparison-pit" x1={x(stop.pitLap)} x2={x(stop.pitLap)} y1="20" y2="170" /><title>#{drivers.find((d) => d.carIdx === stop.carIdx)?.carNumber ?? stop.carIdx} · pit L{stop.pitLap}{stop.driverChange ? ` · driver change to ${stop.exitDriverName ?? "unknown"}` : ""}</title><text x={x(stop.pitLap)} y={index % 2 === 0 ? "12" : "27"} textAnchor="middle">#{drivers.find((d) => d.carIdx === stop.carIdx)?.carNumber ?? stop.carIdx} {stop.driverChange ? "CHANGE" : "PIT"}</text></g>)}
        <path d={path} />
        {points.map((p) => p.value == null ? null : <circle key={p.lapNumber} cx={x(p.lapNumber)} cy={y(p.value)} r="3"><title>L{p.lapNumber}: {p.value.toFixed(3)}s</title></circle>)}
        {[...new Set(Array.from({ length: 6 }, (_, i) => Math.round(firstLap + (lastLap - firstLap) * i / 5)))].map((lap) => <text key={lap} x={x(lap)} y="192" textAnchor="middle">L{lap}</text>)}
      </svg>
      <p>Completed scoring-line observations, matched by lap. Missing or lapped gaps remain unavailable.</p>
      <details><summary>Lap values and pit markers</summary><div className="comparison-values">{points.map((p) => <span key={p.lapNumber}><small>L{p.lapNumber}</small><strong>{p.value == null ? "—" : `${p.value.toFixed(3)}s`}</strong></span>)}</div>{stops.map((stop) => <p key={`${stop.carIdx}:${stop.pitEntryTime}`}>L{stop.pitLap} · #{drivers.find((d) => d.carIdx === stop.carIdx)?.carNumber ?? stop.carIdx} · pit stop{stop.driverChange ? ` · ${stop.entryDriverName ?? "Unknown"} → ${stop.exitDriverName ?? "Unknown"}` : ""}</p>)}</details>
    </>}
  </section>;
}
