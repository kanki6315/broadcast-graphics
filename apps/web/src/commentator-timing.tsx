import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Columns3, Flag, GitCommitHorizontal, LogOut, Map as MapIcon, MonitorCog, TriangleAlert, Wifi, WifiOff } from "lucide-react";
import { isExpectedUnavailableTimingField, type DriverState } from "@racecontrol/protocol";
import {
  commentatorColumnLabels,
  defaultCommentatorColumns,
  CommentatorTimingTable,
  type CommentatorColumn,
} from "./timing-table";
import { LinearTrackRibbon } from "./linear-track-ribbon";
import { BattleWatch } from "./battle-watch";
import { useLiveState } from "./use-live-state";
import { CircuitMap } from "./circuit-map";
import { useTrackMap } from "./use-track-map";
import "./commentator-timing.css";

const preferencesKey = "gantry.commentator-timing.v1";

interface CommentatorPreferences {
  classId: number | "all";
  selectedCarIdx: number | null;
  expandedCarIdxs: number[];
  visibleColumns: CommentatorColumn[];
  positionView: "map" | "ribbon";
}

const defaultPreferences: CommentatorPreferences = {
  classId: "all",
  selectedCarIdx: null,
  expandedCarIdxs: [],
  visibleColumns: [...defaultCommentatorColumns],
  positionView: "map",
};

function loadPreferences(): CommentatorPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(preferencesKey) ?? "null") as Partial<CommentatorPreferences> | null;
    if (!stored) return defaultPreferences;
    const validColumns = (stored.visibleColumns ?? []).filter((column): column is CommentatorColumn => column in commentatorColumnLabels);
    return {
      classId: stored.classId === "all" || typeof stored.classId === "number" ? stored.classId : "all",
      selectedCarIdx: typeof stored.selectedCarIdx === "number" ? stored.selectedCarIdx : null,
      expandedCarIdxs: Array.isArray(stored.expandedCarIdxs)
        ? stored.expandedCarIdxs.filter((carIdx): carIdx is number => typeof carIdx === "number")
        : [],
      visibleColumns: validColumns.length > 0 ? validColumns : [...defaultCommentatorColumns],
      positionView: stored.positionView === "ribbon" ? "ribbon" : "map",
    };
  } catch {
    return defaultPreferences;
  }
}

function sortClassFirst(drivers: DriverState[]): DriverState[] {
  return [...drivers].sort((left, right) =>
    left.className.localeCompare(right.className)
      || left.classPosition - right.classPosition
      || left.position - right.position);
}

export function CommentatorTiming({ onLogout }: { onLogout: () => Promise<void> }) {
  const { state, socketConnected } = useLiveState("control", "commentator");
  const [preferences, setPreferences] = useState<CommentatorPreferences>(loadPreferences);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const mapResource = useTrackMap(state?.trackConfiguration?.activeMap);

  useEffect(() => {
    window.localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  }, [preferences]);

  const classes = state?.session?.classes ?? [];
  const filteredDrivers = useMemo(() => {
    const drivers = state?.session?.drivers ?? [];
    return sortClassFirst(preferences.classId === "all"
      ? drivers
      : drivers.filter((driver) => driver.classId === preferences.classId));
  }, [preferences.classId, state?.session?.drivers]);

  useEffect(() => {
    if (filteredDrivers.length === 0) return;
    if (filteredDrivers.some((driver) => driver.carIdx === preferences.selectedCarIdx)) return;
    setPreferences((current) => ({ ...current, selectedCarIdx: filteredDrivers[0]?.carIdx ?? null }));
  }, [filteredDrivers, preferences.selectedCarIdx]);

  const selectedDriver = filteredDrivers.find((driver) => driver.carIdx === preferences.selectedCarIdx) ?? null;
  const nearbyClassCarIdxs = useMemo(() => new Set(filteredDrivers
    .filter((driver) => selectedDriver
      && driver.classId === selectedDriver.classId
      && driver.carIdx !== selectedDriver.carIdx
      && Math.abs(driver.classPosition - selectedDriver.classPosition) <= 2)
    .map((driver) => driver.carIdx)), [filteredDrivers, selectedDriver]);
  const expandedCarIdxs = useMemo(() => new Set(preferences.expandedCarIdxs), [preferences.expandedCarIdxs]);
  const visibleColumns = useMemo(() => new Set(preferences.visibleColumns), [preferences.visibleColumns]);

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
    setPreferences((current) => ({
      ...current,
      expandedCarIdxs: current.expandedCarIdxs.includes(carIdx)
        ? current.expandedCarIdxs.filter((candidate) => candidate !== carIdx)
        : [...current.expandedCarIdxs, carIdx],
    }));
  }

  function toggleColumn(column: CommentatorColumn) {
    setPreferences((current) => ({
      ...current,
      visibleColumns: current.visibleColumns.includes(column)
        ? current.visibleColumns.filter((candidate) => candidate !== column)
        : [...current.visibleColumns, column],
    }));
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
  const isSimulated = session?.sourceMode === "simulation";
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

      <main className="commentator-workspace" aria-labelledby="commentator-title">
        <section className="commentator-heading">
          <div>
            <h1 id="commentator-title">Race timing</h1>
            <p>{selectedDriver ? `Following #${selectedDriver.carNumber} ${selectedDriver.name} · ${selectedDriver.className} P${selectedDriver.classPosition}` : "Select a car to follow its class battle and stop detail."}</p>
          </div>
          <div className="commentator-key" aria-label="Timing key">
            <span><i className="key-selection" />Selected</span>
            <span><i className="key-rival" />Nearby in class</span>
            <span><b>~</b>Contains inference</span>
            <span><b>?</b>Quality not reported</span>
          </div>
        </section>

        <section className="commentator-controls" aria-label="Timing view controls">
          <div className="class-filter" role="group" aria-label="Class filter">
            <button className={preferences.classId === "all" ? "is-selected" : ""} onClick={() => selectClass("all")}>All classes <span>{session?.drivers.length ?? 0}</span></button>
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
          <details className="column-chooser">
            <summary><Columns3 aria-hidden="true" />Columns <span>{visibleColumns.size + 2}</span></summary>
            <fieldset>
              <legend>Visible timing groups</legend>
              {(Object.keys(commentatorColumnLabels) as CommentatorColumn[]).map((column) => (
                <label key={column}><input type="checkbox" checked={visibleColumns.has(column)} onChange={() => toggleColumn(column)} />{commentatorColumnLabels[column]}</label>
              ))}
            </fieldset>
          </details>
          <div className="position-view-toggle" role="group" aria-label="Track position view">
            <button className={preferences.positionView === "map" ? "is-selected" : ""} onClick={() => setPreferences((current) => ({ ...current, positionView: "map" }))}><MapIcon aria-hidden="true" />Map</button>
            <button className={preferences.positionView === "ribbon" ? "is-selected" : ""} onClick={() => setPreferences((current) => ({ ...current, positionView: "ribbon" }))}><GitCommitHorizontal aria-hidden="true" />Ribbon</button>
          </div>
        </section>

        <section className="commentator-intelligence" aria-label="Live race intelligence">
          <BattleWatch intelligence={intelligence} drivers={session?.drivers ?? []} classId={preferences.classId} selectedCarIdx={preferences.selectedCarIdx} onSelectCar={(carIdx) => setPreferences((current) => ({ ...current, selectedCarIdx: carIdx }))} />
          <div className={`quality-watch${warnings.length > 0 ? " has-warnings" : ""}`}>
            <TriangleAlert aria-hidden="true" />
            <div><strong>{warnings.length > 0 ? `${warnings.length} timing warning${warnings.length === 1 ? "" : "s"}` : "Timing quality clear"}</strong><span>{warnings[0]?.message ?? "No uncertain normalized values in this view."}</span></div>
          </div>
        </section>

        <div className="commentator-position-instrument">
          {preferences.positionView === "map" && mapResource.definition && mapResource.calibration ? (
            <CircuitMap
              definition={mapResource.definition}
              calibration={mapResource.calibration}
              drivers={filteredDrivers}
              selectedCarIdx={preferences.selectedCarIdx}
              nearbyCarIdxs={nearbyClassCarIdxs}
              sectorBoundaries={state.trackConfiguration?.activeSectorDefinition?.boundaries}
              onSelectCar={(carIdx) => setPreferences((current) => ({ ...current, selectedCarIdx: carIdx }))}
              fallback={<LinearTrackRibbon drivers={filteredDrivers} selectedCarIdx={preferences.selectedCarIdx} nearbyCarIdxs={nearbyClassCarIdxs} onSelectCar={(carIdx) => setPreferences((current) => ({ ...current, selectedCarIdx: carIdx }))} variant="commentator" />}
            />
          ) : (
            <>
              {preferences.positionView === "map" && <p className="map-fallback-status" role="status">{mapResource.loading ? "Loading calibrated circuit map…" : mapResource.error ? `${mapResource.error} Showing linear track.` : "No verified map is active for this layout. Showing linear track."}</p>}
              <LinearTrackRibbon
                drivers={filteredDrivers}
                selectedCarIdx={preferences.selectedCarIdx}
                nearbyCarIdxs={nearbyClassCarIdxs}
                onSelectCar={(carIdx) => setPreferences((current) => ({ ...current, selectedCarIdx: carIdx }))}
                variant="commentator"
              />
            </>
          )}
        </div>

        <CommentatorTimingTable
          drivers={filteredDrivers}
          selectedCarIdx={preferences.selectedCarIdx}
          nearbyCarIdxs={nearbyClassCarIdxs}
          expandedCarIdxs={expandedCarIdxs}
          visibleColumns={visibleColumns}
          groupByClass={preferences.classId === "all"}
          stints={intelligence?.stints}
          gapTrends={intelligence?.gapTrends}
          pitCycles={intelligence?.pitCycles}
          onSelectCar={(carIdx) => setPreferences((current) => ({ ...current, selectedCarIdx: carIdx }))}
          onToggleExpanded={toggleExpanded}
        />
      </main>
    </div>
  );
}
