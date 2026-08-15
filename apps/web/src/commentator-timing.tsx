import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Columns3, Flag, LineChart, LogOut, MonitorCog, TriangleAlert, Wifi, WifiOff } from "lucide-react";
import { isExpectedUnavailableTimingField, type CompletedSessionReview, type DriverState, type HistorySessionSummary } from "@racecontrol/protocol";
import {
  commentatorColumnLabels,
  defaultCommentatorColumns,
  CommentatorTimingTable,
  sortByClassPosition,
  sortByOverallPosition,
  type CommentatorColumn,
} from "./timing-table";
import { LinearTrackRibbon } from "./linear-track-ribbon";
import { BattleWatch } from "./battle-watch";
import { useLiveState } from "./use-live-state";
import { CircuitMap } from "./circuit-map";
import { useTrackMap } from "./use-track-map";
import { useGapHistory } from "./use-gap-history";
import { GapVisualizer } from "./gap-visualizer";
import { SessionReview } from "./session-review";
import { timingJson } from "./timing-api";
import "./commentator-timing.css";

const preferencesKey = "gantry.commentator-timing.v1";

interface CommentatorPreferences {
  classId: number | "all";
  expandedCarIdxs: number[];
  visibleColumns: CommentatorColumn[];
}

const defaultPreferences: CommentatorPreferences = {
  classId: "all",
  expandedCarIdxs: [],
  visibleColumns: [...defaultCommentatorColumns],
};

function loadPreferences(): CommentatorPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(preferencesKey) ?? "null") as Partial<CommentatorPreferences> | null;
    if (!stored) return defaultPreferences;
    const validColumns = (stored.visibleColumns ?? []).filter((column): column is CommentatorColumn => column in commentatorColumnLabels);
    return {
      classId: stored.classId === "all" || typeof stored.classId === "number" ? stored.classId : "all",
      expandedCarIdxs: Array.isArray(stored.expandedCarIdxs)
        ? stored.expandedCarIdxs.filter((carIdx): carIdx is number => typeof carIdx === "number")
        : [],
      visibleColumns: validColumns.length > 0 ? validColumns : [...defaultCommentatorColumns],
    };
  } catch {
    return defaultPreferences;
  }
}

export function CommentatorTiming({ onLogout }: { onLogout: () => Promise<void> }) {
  const { state, socketConnected } = useLiveState("control", "commentator");
  const [preferences, setPreferences] = useState<CommentatorPreferences>(loadPreferences);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [historySessions, setHistorySessions] = useState<HistorySessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("live");
  const [sessionReview, setSessionReview] = useState<CompletedSessionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewingHistory = selectedSessionId !== "live";
  const mapResource = useTrackMap(state?.trackConfiguration?.activeMap);
  const gapHistory = useGapHistory(state?.session?.id);

  useEffect(() => {
    if (state?.session?.id) setSelectedSessionId("live");
  }, [state?.session?.id]);

  useEffect(() => {
    const eventId = state?.session?.externalSubSessionId;
    let cancelled = false;
    const query = eventId == null ? "" : `?eventId=${encodeURIComponent(eventId)}`;
    void timingJson<HistorySessionSummary[]>(`/api/history/sessions${query}`)
      .then((sessions) => { if (!cancelled) setHistorySessions(sessions); })
      .catch(() => { if (!cancelled) setHistorySessions([]); });
    return () => { cancelled = true; };
  }, [state?.session?.externalSubSessionId, state?.session?.id]);

  useEffect(() => {
    if (!reviewingHistory || preferences.classId === "all" || sessionReview?.classes.some((carClass) => carClass.id === preferences.classId)) return;
    setPreferences((current) => ({ ...current, classId: "all" }));
  }, [preferences.classId, reviewingHistory, sessionReview?.classes]);

  useEffect(() => {
    if (selectedSessionId === "live") {
      setSessionReview(null);
      setReviewError("");
      setReviewLoading(false);
      return;
    }
    let cancelled = false;
    setReviewLoading(true);
    setReviewError("");
    void timingJson<CompletedSessionReview>(`/api/history/sessions/${encodeURIComponent(selectedSessionId)}`)
      .then((review) => { if (!cancelled) setSessionReview(review); })
      .catch((loadError) => { if (!cancelled) setReviewError(loadError instanceof Error ? loadError.message : "Completed session could not be loaded."); })
      .finally(() => { if (!cancelled) setReviewLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  useEffect(() => {
    window.localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  }, [preferences]);

  const classes = reviewingHistory ? sessionReview?.classes ?? [] : state?.session?.classes ?? [];
  const filteredDrivers = useMemo(() => {
    const drivers = state?.session?.drivers ?? [];
    return preferences.classId === "all"
      ? sortByOverallPosition(drivers)
      : sortByClassPosition(drivers.filter((driver) => driver.classId === preferences.classId));
  }, [preferences.classId, state?.session?.drivers]);

  const expandedCarIdxs = useMemo(() => new Set(preferences.expandedCarIdxs), [preferences.expandedCarIdxs]);
  const visibleColumns = useMemo(() => new Set(preferences.visibleColumns), [preferences.visibleColumns]);

  useEffect(() => {
    if (!state?.session?.id) return;
    for (const carIdx of preferences.expandedCarIdxs) void gapHistory.loadRecentLaps(carIdx);
  }, [gapHistory.loadRecentLaps, preferences.expandedCarIdxs, state?.session?.id]);

  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await onLogout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Sign out failed. This session remains active.");
      setLoggingOut(false);
    }
  }

  function selectClass(classId: number | "all") {
    setPreferences((current) => ({ ...current, classId }));
  }

  function toggleExpanded(carIdx: number) {
    if (!preferences.expandedCarIdxs.includes(carIdx)) void gapHistory.loadRecentLaps(carIdx);
    setPreferences((current) => ({
      ...current,
      expandedCarIdxs: current.expandedCarIdxs.includes(carIdx)
        ? current.expandedCarIdxs.filter((candidate) => candidate !== carIdx)
        : [...current.expandedCarIdxs, carIdx],
    }));
  }

  function openGapVisualizer() {
    if (!session) return;
    const leadingClassId = sortByOverallPosition(session.drivers).find((driver) => driver.classPosition > 0)?.classId;
    const classId = preferences.classId === "all" ? leadingClassId ?? session.classes[0]?.id : preferences.classId;
    if (classId != null) void gapHistory.openClassHistory(classId);
  }

  function toggleColumn(column: CommentatorColumn) {
    setPreferences((current) => ({
      ...current,
      visibleColumns: current.visibleColumns.includes(column)
        ? current.visibleColumns.filter((candidate) => candidate !== column)
        : [...current.visibleColumns, column],
    }));
  }

  async function selectSectorRevision(revision: string) {
    if (selectedSessionId === "live") return;
    setReviewLoading(true);
    setReviewError("");
    try {
      setSessionReview(await timingJson<CompletedSessionReview>(`/api/history/sessions/${encodeURIComponent(selectedSessionId)}?revision=${encodeURIComponent(revision)}`));
    } catch (loadError) {
      setReviewError(loadError instanceof Error ? loadError.message : "That sector definition could not be loaded.");
    } finally {
      setReviewLoading(false);
    }
  }

  if (!state) {
    return (
      <main className="loading-screen">
        <img className="loading-brand-mark" src="/brand/gantry-mark.svg" alt="" />
        <h1>Opening commentator timing</h1>
        <p>Waiting for the read-only race-state connection.</p>
      </main>
    );
  }

  const telemetryHealthy = socketConnected && state.connection === "connected";
  const session = state.session;
  const overallFastestCarIdx = session?.drivers.reduce<DriverState | undefined>((fastest, driver) => {
    const quality = driver.timingQuality?.bestLap?.quality;
    if (driver.bestLap == null || !Number.isFinite(driver.bestLap) || driver.bestLap <= 0 || quality === "invalid" || quality === "incomplete") return fastest;
    return !fastest || driver.bestLap < fastest.bestLap! ? driver : fastest;
  }, undefined)?.carIdx;
  const isSimulated = session?.sourceMode === "simulation";
  const showClassGaps = classes.length > 1 || new Set(session?.drivers.map((driver) => driver.classId)).size > 1;
  const displayedColumnCount = 2 + [...visibleColumns].filter((column) => showClassGaps || (column !== "gap" && column !== "interval")).length;
  const intelligence = state.intelligence;
  const warningCarIdxs = new Set(filteredDrivers.map((driver) => driver.carIdx));
  const driversByCarIdx = new Map(filteredDrivers.map((driver) => [driver.carIdx, driver]));
  const warnings = (intelligence?.qualityWarnings ?? []).filter((warning) => {
    if (warning.carIdx == null) return true;
    if (!warningCarIdxs.has(warning.carIdx)) return false;
    const driver = driversByCarIdx.get(warning.carIdx);
    return !driver || !isExpectedUnavailableTimingField(driver, warning.field);
  });

  return (
    <div className="commentator-shell">
      <header className="commentator-masthead">
        <div className="commentator-brand">
          <img src="/brand/gantry-mark.svg" alt="" />
          <div><strong>Gantry timing</strong><span>Commentator workspace</span></div>
        </div>
        <div className={`commentator-connection ${telemetryHealthy ? "is-good" : "is-bad"}`}>
          {telemetryHealthy ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <div><strong>{telemetryHealthy ? "Live" : state.connection}</strong><span>{telemetryHealthy ? "Feed current" : "Check telemetry"}</span></div>
        </div>
        <div className="commentator-session">
          <strong>{isSimulated ? `Simulated · ${session?.name}` : session?.name ?? "Waiting for session"}</strong>
          <span>{session ? `${session.trackName} · Lap ${session.lap}${session.totalLaps ? ` / ${session.totalLaps}` : ""}` : "No normalized timing received"}</span>
        </div>
        <div className={`commentator-flag flag-${session?.flag ?? "green"}`}><Flag aria-hidden="true" /><strong>{session?.flag ?? "No flag"}</strong></div>
        <nav className="commentator-nav" aria-label="Commentator account">
          <a href="/control"><MonitorCog aria-hidden="true" />Control desk</a>
          <button onClick={() => void logout()} disabled={loggingOut}><LogOut aria-hidden="true" />{loggingOut ? "Signing out" : "Sign out"}</button>
          {logoutError && <span role="alert">{logoutError}</span>}
        </nav>
      </header>

      <main className={`commentator-workspace${reviewingHistory ? " is-reviewing-history" : ""}`} aria-labelledby="commentator-title">
        <div className="commentator-commandbar">
          <section className="commentator-heading">
            <div>
              <h1 id="commentator-title">{reviewingHistory ? "Session review" : "Race timing"}</h1>
              <p>{reviewingHistory ? "Frozen classifications and recorded sector evidence." : "Live running order, battle candidates, stint context, and pit detail."}</p>
            </div>
            <label className="session-selector">
              <span>Session data</span>
              <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
                <option value="live">Active · {session?.name ?? "waiting"}</option>
                {historySessions.map((historySession) => <option key={historySession.id} value={historySession.id}>Completed · {historySession.name} · {historySession.trackName}</option>)}
              </select>
            </label>
          </section>

          <section className="commentator-controls" aria-label="Timing view controls">
            <div className="class-filter" role="group" aria-label="Class filter">
              <button className={preferences.classId === "all" ? "is-selected" : ""} onClick={() => selectClass("all")}>All classes <span>{reviewingHistory ? sessionReview?.results.length ?? 0 : session?.drivers.length ?? 0}</span></button>
              {classes.map((carClass) => (
                <button
                  key={carClass.id}
                  className={preferences.classId === carClass.id ? "is-selected" : ""}
                  onClick={() => selectClass(carClass.id)}
                  style={{ "--class-color": carClass.color } as CSSProperties}
                >
                  {carClass.name} <span>{carClass.carCount}</span>
                </button>
              ))}
            </div>
            {!reviewingHistory && <details className="column-chooser">
              <summary><Columns3 aria-hidden="true" />Columns <span>{displayedColumnCount}</span></summary>
              <fieldset>
                <legend>Visible timing groups</legend>
                {(Object.keys(commentatorColumnLabels) as CommentatorColumn[])
                  .filter((column) => showClassGaps || (column !== "gap" && column !== "interval"))
                  .map((column) => (
                  <label key={column}><input type="checkbox" checked={visibleColumns.has(column)} onChange={() => toggleColumn(column)} />{commentatorColumnLabels[column]}</label>
                ))}
              </fieldset>
            </details>}
            {!reviewingHistory && <button className={`gap-visualizer-trigger${gapHistory.modal.open ? " is-selected" : ""}`} onClick={openGapVisualizer} disabled={!session || classes.length === 0}><LineChart aria-hidden="true" />Gap visualizer</button>}
          </section>

          <div className="commentator-key" aria-label="Timing key">
            <span><b>~</b>Contains inference</span>
            <span><b>{reviewingHistory ? "—" : "?"}</b>{reviewingHistory ? "Unavailable / invalid" : "Quality not reported"}</span>
          </div>
        </div>

        {reviewingHistory ? <SessionReview review={sessionReview} loading={reviewLoading} error={reviewError} classId={preferences.classId} onRevisionChange={(revision) => void selectSectorRevision(revision)} /> : <>
        <section className="commentator-context-deck" aria-label="Circuit position and live race intelligence">
          <div className="commentator-position-instrument">
          {mapResource.definition && mapResource.calibration ? (
            <CircuitMap
              definition={mapResource.definition}
              calibration={mapResource.calibration}
              drivers={filteredDrivers}
              sectorBoundaries={state.trackConfiguration?.activeSectorDefinition?.boundaries}
              fallback={<LinearTrackRibbon drivers={filteredDrivers} variant="commentator" />}
            />
          ) : (
            <>
              <p className="map-fallback-status" role="status">{mapResource.loading ? "Loading calibrated circuit map…" : mapResource.error ? `${mapResource.error} Showing linear track.` : "No verified map is active for this layout. Showing linear track."}</p>
              <LinearTrackRibbon
                drivers={filteredDrivers}
                variant="commentator"
              />
            </>
          )}
          </div>
          <div className="commentator-battle-context">
            <BattleWatch intelligence={intelligence} drivers={session?.drivers ?? []} classId={preferences.classId} />
            <div className={`quality-watch${warnings.length > 0 ? " has-warnings" : ""}`}>
              <TriangleAlert aria-hidden="true" />
              <strong>{warnings.length > 0 ? `${warnings.length} timing warning${warnings.length === 1 ? "" : "s"}` : "Timing quality clear"}</strong>
              <span>{warnings[0]?.message ?? "No uncertain normalized values in this view."}</span>
            </div>
          </div>
        </section>

        <CommentatorTimingTable
          drivers={filteredDrivers}
          overallFastestCarIdx={overallFastestCarIdx}
          expandedCarIdxs={expandedCarIdxs}
          visibleColumns={visibleColumns}
          groupByClass={false}
          showClassGaps={showClassGaps}
          stints={intelligence?.stints}
          gapTrends={intelligence?.gapTrends}
          pitCycles={intelligence?.pitCycles}
          pitStops={intelligence?.pitStops}
          lapHistoryByCarIdx={gapHistory.recentByCarIdx}
          onToggleExpanded={toggleExpanded}
        />
        </>}
      </main>
      {!reviewingHistory && gapHistory.modal.open && <GapVisualizer
        history={gapHistory.modal.history}
        classes={classes}
        loading={gapHistory.modal.loading}
        error={gapHistory.modal.error}
        onSelectClass={(classId) => void gapHistory.openClassHistory(classId)}
        onClose={gapHistory.closeModal}
      />}
    </div>
  );
}
