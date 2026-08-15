import React, { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Database, TriangleAlert } from "lucide-react";
import type { CompletedSector, CompletedSessionReview } from "@racecontrol/protocol";
import { timingJson } from "./timing-api";

interface SessionReviewProps {
  review: CompletedSessionReview | null;
  loading: boolean;
  error: string;
  classId: number | "all";
  onRevisionChange: (revision: string) => void;
}

function formatTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return minutes > 0 ? `${minutes}:${seconds.toFixed(3).padStart(6, "0")}` : seconds.toFixed(3);
}

function formatGap(seconds: number | null, laps: number): string {
  if (laps > 0) return `+${laps}L`;
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return seconds === 0 ? "LEADER" : `+${seconds.toFixed(3)}`;
}

function qualityLabel(sector: CompletedSector): string {
  if (sector.quality === "valid") return formatTime(sector.value);
  if (sector.quality === "inferred" && sector.value != null) return `~${formatTime(sector.value)}`;
  return "—";
}

function sectorsByLap(sectors: CompletedSector[]): Map<number, CompletedSector[]> {
  const grouped = new Map<number, CompletedSector[]>();
  for (const sector of sectors) grouped.set(sector.lapNumber, [...(grouped.get(sector.lapNumber) ?? []), sector]);
  return grouped;
}

async function loadSectors(sessionId: string, carIdx: number, revision: string | null): Promise<CompletedSector[]> {
  const query = new URLSearchParams({ carIdx: String(carIdx), limit: "600" });
  if (revision) query.set("revision", revision);
  return timingJson<CompletedSector[]>(`/api/history/sessions/${encodeURIComponent(sessionId)}/sectors?${query}`);
}

export function SessionReview({ review, loading, error, classId, onRevisionChange }: SessionReviewProps) {
  const [expandedCarIdx, setExpandedCarIdx] = useState<number | null>(null);
  const [sectors, setSectors] = useState<CompletedSector[]>([]);
  const [sectorLoading, setSectorLoading] = useState(false);
  const [sectorError, setSectorError] = useState("");

  useEffect(() => {
    setExpandedCarIdx(null);
    setSectors([]);
    setSectorError("");
  }, [review?.session.id, review?.sectorRevision]);

  const results = useMemo(() => {
    const values = review?.results ?? [];
    return classId === "all" ? values : values.filter((result) => result.classId === classId);
  }, [classId, review?.results]);

  async function toggle(carIdx: number) {
    if (!review) return;
    if (expandedCarIdx === carIdx) {
      setExpandedCarIdx(null);
      return;
    }
    setExpandedCarIdx(carIdx);
    setSectors([]);
    setSectorError("");
    setSectorLoading(true);
    try {
      setSectors(await loadSectors(review.session.id, carIdx, review.sectorRevision));
    } catch (loadError) {
      setSectorError(loadError instanceof Error ? loadError.message : "Sector history could not be loaded.");
    } finally {
      setSectorLoading(false);
    }
  }

  if (loading) return <section className="session-review-state"><Database aria-hidden="true" /><strong>Loading completed session</strong><span>Reading classified results and recorded sectors.</span></section>;
  if (error) return <section className="session-review-state is-error"><TriangleAlert aria-hidden="true" /><strong>Session review unavailable</strong><span>{error}</span></section>;
  if (!review) return <section className="session-review-state"><Database aria-hidden="true" /><strong>Select a completed session</strong><span>Stored classifications and sectors will appear here.</span></section>;

  return (
    <section className="session-review" aria-label={`${review.session.name} completed results`}>
      <header className="session-review-header">
        <div>
          <strong>{review.session.name} results</strong>
          <span>{review.session.trackName} · {review.session.resultCount} classified · {review.session.sectorCount} sector records</span>
        </div>
        {review.sectorDefinitions.length > 0 && (
          <label>
            <span>Sector definition</span>
            <select value={review.sectorRevision ?? ""} onChange={(event) => onRevisionChange(event.target.value)}>
              {review.sectorDefinitions.map((definition) => <option key={definition.revision} value={definition.revision}>{definition.source} · {definition.revision}</option>)}
            </select>
          </label>
        )}
      </header>
      <div className="session-review-table-wrap">
        <table className="session-review-table">
          <thead><tr><th>Pos</th><th>Driver / entry</th><th>Laps</th><th>Last lap</th><th>Best lap</th><th>Gap</th><th>Best sectors</th><th>Status</th></tr></thead>
          <tbody>
            {results.map((result) => {
              const expanded = expandedCarIdx === result.carIdx;
              const byLap = sectorsByLap(sectors);
              return [
                <tr key={`result-${result.carIdx}`} className={expanded ? "is-expanded" : ""}>
                  <td className="review-position"><button onClick={() => void toggle(result.carIdx)} aria-expanded={expanded}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<strong>{result.position || "—"}</strong><small>C{result.classPosition || "—"}</small></button></td>
                  <td className="review-driver"><b style={{ "--class-color": result.classColor } as CSSProperties}>{result.carNumber}</b><span><strong>{result.name}</strong><small>{result.team} · {result.className}</small></span></td>
                  <td>{result.lapsCompleted}</td>
                  <td>{formatTime(result.lastLap)}</td>
                  <td className="review-best-lap">{formatTime(result.bestLap)}</td>
                  <td>{formatGap(result.gapToLeader, result.lapsBehindLeader)}</td>
                  <td className="review-best-sectors">{result.bestSectors.length > 0 ? result.bestSectors.map((sector) => <span key={sector.sectorNumber}><small>S{sector.sectorNumber}</small>{qualityLabel(sector)}</span>) : <span className="review-unavailable">No recorded sectors</span>}</td>
                  <td><span className={`review-status status-${result.trackStatus}`}>{result.trackStatus.replaceAll("-", " ")}</span></td>
                </tr>,
                expanded && <tr key={`detail-${result.carIdx}`} className="review-sector-detail"><td colSpan={8}>
                  {sectorLoading ? <p>Loading lap-by-lap sectors…</p> : sectorError ? <p className="is-error">{sectorError}</p> : sectors.length === 0 ? <p>No sector crossings were stored for this entry and revision.</p> : (
                    <div className="review-sector-ledger">
                      {[...byLap].map(([lap, lapSectors]) => <div key={lap}><strong>Lap {lap}</strong>{lapSectors.map((sector) => <span key={`${sector.sectorNumber}-${sector.definitionRevision}`} className={`quality-${sector.quality}`} title={`${sector.source} · ${sector.quality}${sector.reason ? ` · ${sector.reason}` : ""}`}><small>S{sector.sectorNumber}</small>{qualityLabel(sector)}</span>)}</div>)}
                    </div>
                  )}
                </td></tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
