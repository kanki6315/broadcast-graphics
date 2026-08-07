import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatLapTime, type DriverState, type GraphicSlot, type SessionState, type SessionType } from "@racecontrol/protocol";
import { useLiveState } from "./use-live-state";

function formatGap(driver: DriverState): string {
  if (driver.position === 1) return "Leader";
  if (driver.lapsBehindLeader > 0) return `+${driver.lapsBehindLeader} ${driver.lapsBehindLeader === 1 ? "lap" : "laps"}`;
  const gap = driver.gapToLeader ?? driver.interval;
  return gap == null ? "—" : `+${gap.toFixed(3)}`;
}

type TimingTowerMetric = "gap" | "interval" | "lastLap" | "bestLap";

const timingTowerMetricLabels: Record<TimingTowerMetric, string> = {
  gap: "Gap",
  interval: "Interval",
  lastLap: "Last lap",
  bestLap: "Best lap",
};

function timingTowerMetric(value: unknown): TimingTowerMetric {
  return value === "gap" || value === "lastLap" || value === "bestLap" ? value : "interval";
}

function formatTimingTowerMetric(driver: DriverState, metric: TimingTowerMetric): string {
  if (metric === "gap") return formatGap(driver);
  if (metric === "interval") {
    if (driver.position === 1) return "Leader";
    return driver.intervalToAhead == null ? "—" : `+${driver.intervalToAhead.toFixed(3)}`;
  }
  return formatPylonLapTime(metric === "lastLap" ? driver.lastLap : driver.bestLap);
}

function formatBattleGap(selected: DriverState, rival: DriverState): string {
  const lapDifference = Math.abs(selected.lapsCompleted - rival.lapsCompleted);
  if (lapDifference > 0) return `${lapDifference} ${lapDifference === 1 ? "lap" : "laps"}`;
  const selectedGap = selected.gapToLeader ?? selected.interval;
  const rivalGap = rival.gapToLeader ?? rival.interval;
  return selectedGap == null || rivalGap == null ? "—" : `${Math.abs(selectedGap - rivalGap).toFixed(3)}`;
}

function usePackageTheme(packageId: string | undefined) {
  useEffect(() => {
    if (!packageId) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/packages/${packageId}/theme.css`;
    link.dataset.graphicPackage = packageId;
    document.head.appendChild(link);
    return () => link.remove();
  }, [packageId]);
}

function formatSessionClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "LIVE";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function broadcastSurname(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const particles = new Set(["da", "de", "del", "della", "der", "di", "dos", "du", "la", "le", "van", "von"]);
  let start = parts.length - 1;
  while (start > 0 && particles.has(parts[start - 1].toLowerCase())) start -= 1;
  return parts.slice(start).join(" ");
}

function formatPylonLapTime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return seconds < 60 ? seconds.toFixed(3) : formatLapTime(seconds);
}

const priResultsTrackMiles = 2.5;

function formatResultsSpeed(driver: DriverState): string {
  if (driver.bestLap == null || !Number.isFinite(driver.bestLap) || driver.bestLap <= 0) return "—";
  return (priResultsTrackMiles * 3600 / driver.bestLap).toFixed(3);
}

function formatResultsGap(driver: DriverState, leader: DriverState | undefined, sessionType: SessionType): string {
  if (driver.position === 1) return "LEADER";
  if (sessionType === "race") {
    if (driver.lapsBehindLeader > 0) return `+${driver.lapsBehindLeader} ${driver.lapsBehindLeader === 1 ? "LAP" : "LAPS"}`;
    const gap = driver.gapToLeader ?? driver.interval;
    return gap == null ? "—" : `+${gap.toFixed(3)}`;
  }
  if (driver.bestLap == null || leader?.bestLap == null) return "—";
  return `+${Math.max(0, driver.bestLap - leader.bestLap).toFixed(3)}`;
}

function ResultsPage({
  session,
  requestedSessionType,
  metric,
  packageId,
}: {
  session: SessionState | null;
  requestedSessionType: SessionType;
  metric: "speed" | "gap";
  packageId?: string;
}) {
  const drivers = [...(session?.drivers ?? [])]
    .filter((driver) => driver.position > 0)
    .sort((a, b) => a.position - b.position)
    .slice(0, 10);
  const leader = drivers[0];
  const metricLabel = metric === "speed" ? "SPEED" : "GAP TO LEADER";
  const metricValue = (driver: DriverState) => metric === "speed"
    ? formatResultsSpeed(driver)
    : formatResultsGap(driver, leader, session?.type ?? requestedSessionType);

  if (packageId !== "pri-hoosier-500") {
    return (
      <div className="overlay-surface results-overlay overlay-plate">
        <header className="results-heading overlay-title">
          <strong>{session?.name ?? requestedSessionType} results</strong>
          <span>{metricLabel}</span>
        </header>
        <ol className="results-list">
          {drivers.map((driver) => (
            <li key={driver.carIdx} className="overlay-rule">
              <span className="results-position">{driver.position}.</span>
              <strong className="results-number overlay-accent">{driver.carNumber}</strong>
              <span className="results-name">{driver.name}</span>
              <span className="results-value">{metricValue(driver)}</span>
            </li>
          ))}
        </ol>
        {!session && <p className="results-unavailable">{requestedSessionType} results unavailable</p>}
      </div>
    );
  }

  return (
    <div className="overlay-surface results-overlay pri-results-overlay">
      <img className="results-panel-background" src="/packages/pri-hoosier-500/results-panel-background.png" alt="" />
      <header className="results-heading">
        <h1>2026 PRI HOOSIER 500</h1>
        <p>{(session?.type ?? requestedSessionType).toUpperCase()} RESULTS</p>
      </header>
      <img className="results-event-logo" src="/packages/pri-hoosier-500/results-event-logo.png" alt="PRI Hoosier 500" />
      <img className="results-separator" src="/packages/pri-hoosier-500/results-separator.png" alt="" />
      <span className="results-metric-label">{metricLabel}</span>
      <ol className="results-list">
        {drivers.map((driver) => (
          <li key={driver.carIdx}>
            <span className="results-position">{driver.position}.</span>
            <strong className="results-number">{driver.carNumber}</strong>
            <span className="results-name">{driver.name}</span>
            <span className="results-value">{metricValue(driver)}</span>
          </li>
        ))}
      </ol>
      {!session && <p className="results-unavailable">RESULTS UNAVAILABLE</p>}
      <footer className="results-presenter">
        <span>RESULTS PRESENTED BY</span>
        <img src="/packages/pri-hoosier-500/results-presenter-logo.png" alt="Visitor Watch Company" />
      </footer>
    </div>
  );
}

function TimingTower({
  session,
  totalCars,
  visibleRows,
  fixedPositions,
  metric,
  packageId,
}: {
  session: SessionState;
  totalCars: number;
  visibleRows: number;
  fixedPositions: number;
  metric: TimingTowerMetric;
  packageId?: string;
}) {
  const includedCount = Math.max(1, Math.min(Math.floor(totalCars), session.drivers.length));
  const visibleCount = Math.max(1, Math.min(Math.floor(visibleRows), includedCount));
  const includedDrivers = session.drivers.slice(0, includedCount);
  const needsRotation = includedCount > visibleCount;
  const fixedCount = needsRotation
    ? Math.max(0, Math.min(Math.floor(fixedPositions), visibleCount - 1))
    : visibleCount;
  const rotatingSlots = visibleCount - fixedCount;
  const rotatingPool = includedDrivers.slice(fixedCount);
  const rotationPages = needsRotation ? Math.ceil(rotatingPool.length / rotatingSlots) : 1;
  const includedDriverOrder = includedDrivers.map((driver) => driver.carIdx).join(":");
  const [rotationPage, setRotationPage] = useState(0);
  const metricLabel = timingTowerMetricLabels[metric];
  const isPositionMetric = metric === "gap" || metric === "interval";
  const visibleDrivers = !needsRotation
    ? includedDrivers
    : [
        ...includedDrivers.slice(0, fixedCount),
        ...Array.from({ length: rotatingSlots }, (_, index) => rotatingPool[(rotationPage * rotatingSlots + index) % rotatingPool.length]),
      ];
  const visibleDriverOrder = visibleDrivers.map((driver) => driver.carIdx).join(":");
  const rowElements = useRef(new Map<number, HTMLLIElement>());
  const previousTops = useRef(new Map<number, number>());

  useEffect(() => {
    setRotationPage(0);
    if (rotationPages <= 1) return;
    const timer = window.setInterval(() => {
      setRotationPage((page) => (page + 1) % rotationPages);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [fixedCount, includedDriverOrder, rotatingSlots, rotationPages]);

  useLayoutEffect(() => {
    const currentTops = new Map<number, number>();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const driver of visibleDrivers) {
      const element = rowElements.current.get(driver.carIdx);
      if (!element) continue;
      const top = element.offsetTop;
      currentTops.set(driver.carIdx, top);
      const previousTop = previousTops.current.get(driver.carIdx);
      const distance = previousTop == null ? 0 : previousTop - top;
      if (!reduceMotion && Math.abs(distance) > 1) {
        for (const animation of element.getAnimations()) animation.cancel();
        element.animate(
          [
            { transform: `translateY(${distance}px)`, zIndex: 2 },
            { transform: "translateY(0)", zIndex: 2 },
          ],
          { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
      }
    }
    previousTops.current = currentTops;
  }, [visibleDriverOrder]);

  if (packageId !== "pri-hoosier-500") {
    return (
      <div className="overlay-surface timing-overlay">
        <div className="tower-brand overlay-title">
          <strong>PRI</strong>
          <span>HOOSIER 500</span>
        </div>
        <header className="tower-session overlay-title">
          <strong>{session.type}</strong>
          <span>{session.totalLaps ? `LAP ${session.lap} / ${session.totalLaps}` : formatSessionClock(session.timeRemaining)}</span>
        </header>
        <div className="tower-columns overlay-title"><span>Pos</span><span>Car</span><span>Driver</span><strong>{metricLabel}</strong></div>
        <ol className="overlay-plate">
          {visibleDrivers.map((driver) => (
            <li
              key={driver.carIdx}
              ref={(element) => {
                if (element) rowElements.current.set(driver.carIdx, element);
                else rowElements.current.delete(driver.carIdx);
              }}
              className="overlay-rule"
            >
              <span className="position-chip">{driver.position}</span>
              <span className="overlay-accent overlay-number">{driver.carNumber}</span>
              <strong>{driver.name}</strong>
              <span>{formatTimingTowerMetric(driver, metric)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="overlay-surface timing-overlay">
      <div className="tower-brand" role="img" aria-label="PRI Hoosier 500" />
      <div className="tower-body">
        <div className="tower-body-inner">
          <header className="tower-session overlay-title">
            <strong>{session.type}</strong>
            <span>{session.timeRemaining != null ? formatSessionClock(session.timeRemaining) : session.totalLaps ? `${session.lap} / ${session.totalLaps}` : "LIVE"}</span>
          </header>
          <div className="tower-columns overlay-title">
            <span>{isPositionMetric ? "Running order" : `${metricLabel} time`}</span>
            <strong>{metricLabel}</strong>
          </div>
          <ol className="overlay-plate">
            {visibleDrivers.map((driver, index) => (
              <li
                key={driver.carIdx}
                ref={(element) => {
                  if (element) rowElements.current.set(driver.carIdx, element);
                  else rowElements.current.delete(driver.carIdx);
                }}
                className={`overlay-rule ${needsRotation && index >= fixedCount ? "is-rotating" : ""}`}
              >
                <span className="position-chip">{driver.position}</span>
                <span className="overlay-accent overlay-number">{driver.carNumber}</span>
                <strong>{broadcastSurname(driver.name)}</strong>
                <span>{formatTimingTowerMetric(driver, metric)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function DriverIdentity({ driver, config }: { driver: DriverState; config: Record<string, string | number | boolean> }) {
  const showTeam = Boolean(config.showTeam ?? true);
  const showPosition = Boolean(config.showPosition ?? true);
  const showGap = Boolean(config.showGap ?? true);
  const showBestLast = Boolean(config.showBestLast ?? false);
  return (
    <div className="driver-info-card overlay-plate">
      <span className="overlay-accent focus-number">{driver.carNumber}</span>
      <div className="focus-identity"><strong className="overlay-title">{broadcastSurname(driver.name)}</strong>{showTeam && <span>{String(config.subtitle || driver.team)}</span>}</div>
      {showPosition && <div className="focus-position"><span>Position</span><strong>P{driver.position}</strong></div>}
      {showGap && <div className="focus-metric"><span>Gap</span><strong>{formatGap(driver)}</strong></div>}
      {showBestLast && <div className="focus-metric focus-laps"><span>Best / Last</span><strong>{formatLapTime(driver.bestLap)} / {formatLapTime(driver.lastLap)}</strong></div>}
    </div>
  );
}

function DriverFocus({ driver, compareDriver, config }: { driver?: DriverState; compareDriver?: DriverState; config: Record<string, string | number | boolean> }) {
  if (!driver) return null;
  const compare = Boolean(config.compareEnabled) && compareDriver;
  return (
    <div className={`overlay-surface lower-overlay driver-focus-overlay${compare ? " is-comparing" : ""}`}>
      <DriverIdentity driver={driver} config={config} />
      {compare && <><div className="driver-compare-gap overlay-plate"><span>Gap</span><strong>{formatBattleGap(driver, compareDriver)}</strong></div><DriverIdentity driver={compareDriver} config={config} /></>}
    </div>
  );
}

function RaceStatus({ name, track, lap, total, flag }: { name: string; track: string; lap: number; total: number | null; flag: string }) {
  return <div className="overlay-surface status-overlay overlay-plate"><div><strong className="overlay-title">{name}</strong><span>{track}</span></div><div><span>Lap</span><strong>{lap}{total ? ` / ${total}` : ""}</strong></div><div className={`overlay-accent flag-chip flag-${flag}`}>{flag}</div></div>;
}

function Battle({ drivers, label }: { drivers: DriverState[]; label: string }) {
  if (drivers.length === 0) return null;
  return <div className="overlay-surface battle-overlay overlay-plate"><span className="overlay-title">{label}</span>{drivers.map((driver, index) => <div key={driver.carIdx}><b className={index === 0 ? "overlay-accent" : ""}>{driver.carNumber}</b><strong>{driver.name}</strong><em>{index === 0 ? `P${driver.position}` : formatBattleGap(drivers[index - 1], driver)}</em></div>)}</div>;
}

function LowerThird({ headline, detail }: { headline: string; detail: string }) {
  return <div className="overlay-surface lower-overlay overlay-plate"><span className="overlay-accent lower-mark" /><div><strong className="overlay-title">{headline}</strong><span>{detail}</span></div></div>;
}

function OverlayLayer({ active, children }: { active: boolean; children: ReactNode }) {
  return <section className={`overlay-canvas ${active ? "is-active" : ""}`} aria-hidden={!active}>{children}</section>;
}

export function OverlayApp() {
  const { state } = useLiveState("overlay");
  const queryPackage = new URLSearchParams(window.location.search).get("package");
  const packageId = queryPackage ?? state?.graphics.packageId;
  usePackageTheme(packageId);

  if (!state?.session) return null;
  const activeSlots = new Set(state.graphics.activeSlots);
  const configFor = (slot: GraphicSlot) => state.graphics.slotConfig[slot] ?? {};
  const followed = state.session.drivers.find((driver) => driver.carIdx === state.graphics.selectedDriverCarIdx);
  const focusConfig = configFor("driver-focus");
  const selected = String(focusConfig.targetMode ?? "followed") === "manual"
    ? state.session.drivers.find((driver) => driver.carIdx === Number(focusConfig.manualCarIdx))
    : followed;
  const compareDriver = state.session.drivers.find((driver) => driver.carIdx === Number(focusConfig.compareCarIdx))
    ?? state.session.drivers.find((driver) => driver.carIdx !== selected?.carIdx);
  const battleConfig = configFor("battle");
  const battleStart = String(battleConfig.positionMode ?? "followed") === "followed"
    ? followed?.position ?? 1
    : Number(battleConfig.startPosition ?? 1);
  const battleEnd = battleStart + Math.max(1, Number(battleConfig.carsBehind ?? 3));
  const battleDrivers = state.session.drivers
    .filter((driver) => driver.position >= battleStart && driver.position <= battleEnd)
    .sort((first, second) => first.position - second.position);
  const towerConfig = configFor("timing-tower");
  const towerMetric = timingTowerMetric(towerConfig.metric);
  const defaultTowerRows = 12;
  const legacyRows = Number(towerConfig.rows ?? defaultTowerRows);
  const totalTowerCars = Number(towerConfig.totalCars ?? (packageId === "pri-hoosier-500" ? 20 : legacyRows));
  const visibleTowerRows = Number(towerConfig.visibleRows ?? legacyRows);
  const fixedTowerPositions = Number(towerConfig.fixedPositions ?? (packageId === "pri-hoosier-500" ? 5 : visibleTowerRows));
  const resultsConfig = configFor("results");
  const requestedSessionType = String(resultsConfig.sessionType ?? "practice") as SessionType;
  const resultsSession = state.sessionResults?.[requestedSessionType]
    ?? (state.session.type === requestedSessionType ? state.session : null);
  const resultsMetric = resultsConfig.metric === "gap" ? "gap" : "speed";

  return (
    <main>
      <OverlayLayer active={activeSlots.has("timing-tower")}>
        <TimingTower
          session={state.session}
          totalCars={totalTowerCars}
          visibleRows={visibleTowerRows}
          fixedPositions={fixedTowerPositions}
          metric={towerMetric}
          packageId={packageId}
        />
      </OverlayLayer>
      <OverlayLayer active={activeSlots.has("results")}>
        <ResultsPage session={resultsSession} requestedSessionType={requestedSessionType} metric={resultsMetric} packageId={packageId} />
      </OverlayLayer>
      <OverlayLayer active={activeSlots.has("driver-focus")}><DriverFocus driver={selected} compareDriver={compareDriver} config={focusConfig} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("race-status")}><RaceStatus name={state.session.name} track={state.session.trackName} lap={state.session.lap} total={state.session.totalLaps} flag={state.session.flag} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("battle")}><Battle drivers={battleDrivers} label={String(battleConfig.label ?? `Battle P${battleStart}–P${battleEnd}`)} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("lower-third")}><LowerThird headline={String(configFor("lower-third").headline ?? "Race control")} detail={String(configFor("lower-third").detail ?? "")} /></OverlayLayer>
    </main>
  );
}
