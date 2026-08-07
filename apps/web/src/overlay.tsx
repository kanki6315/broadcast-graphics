import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatLapTime, type DriverState, type GraphicSlot, type SessionState } from "@racecontrol/protocol";
import { useLiveState } from "./use-live-state";

function formatGap(driver: DriverState): string {
  if (driver.position === 1) return "Leader";
  if (driver.lapsBehindLeader > 0) return `+${driver.lapsBehindLeader} ${driver.lapsBehindLeader === 1 ? "lap" : "laps"}`;
  const gap = driver.gapToLeader ?? driver.interval;
  return gap == null ? "—" : `+${gap.toFixed(3)}`;
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

function TimingTower({
  session,
  totalCars,
  visibleRows,
  fixedPositions,
  packageId,
}: {
  session: SessionState;
  totalCars: number;
  visibleRows: number;
  fixedPositions: number;
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
  const isRace = session.type === "race";
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
        <div className="tower-columns overlay-title"><span>Pos</span><span>Car</span><span>Driver</span><strong>Interval</strong></div>
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
              <span>{formatGap(driver)}</span>
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
            <span>{isRace ? "Running order" : "Best lap time"}</span>
            <strong>{isRace ? "Interval" : "Time"}</strong>
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
                <span>{isRace ? formatGap(driver) : formatPylonLapTime(driver.bestLap)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function DriverFocus({ driver, config }: { driver?: DriverState; config: Record<string, string | number | boolean> }) {
  if (!driver) return null;
  const metric = String(config.metric ?? "bestLap");
  const metricValue = metric === "interval"
    ? (driver.intervalToAhead == null ? "—" : `+${driver.intervalToAhead.toFixed(3)}`)
    : formatLapTime(metric === "lastLap" ? driver.lastLap : driver.bestLap);
  return (
    <div className="overlay-surface lower-overlay driver-focus-overlay overlay-plate">
      <span className="overlay-accent focus-number">{driver.carNumber}</span>
      <div className="focus-identity"><strong className="overlay-title">{broadcastSurname(driver.name)}</strong><span>{String(config.subtitle || driver.team)}</span></div>
      <div className="focus-position"><span>Position</span><strong>P{driver.position}</strong></div>
      <div className="focus-metric"><span>{metric.replace(/([A-Z])/g, " $1")}</span><strong>{metricValue}</strong></div>
    </div>
  );
}

function RaceStatus({ name, track, lap, total, flag }: { name: string; track: string; lap: number; total: number | null; flag: string }) {
  return <div className="overlay-surface status-overlay overlay-plate"><div><strong className="overlay-title">{name}</strong><span>{track}</span></div><div><span>Lap</span><strong>{lap}{total ? ` / ${total}` : ""}</strong></div><div className={`overlay-accent flag-chip flag-${flag}`}>{flag}</div></div>;
}

function Battle({ selected, rival, label }: { selected?: DriverState; rival?: DriverState; label: string }) {
  if (!selected || !rival) return null;
  return <div className="overlay-surface battle-overlay overlay-plate"><span className="overlay-title">{label}</span><div><b className="overlay-accent">{selected.carNumber}</b><strong>{selected.name}</strong><em>P{selected.position}</em></div><div><b>{rival.carNumber}</b><strong>{rival.name}</strong><em>{formatBattleGap(selected, rival)}</em></div></div>;
}

function FlagOverlay({ flag, message }: { flag: string; message: string }) {
  return <div className={`overlay-surface flag-overlay flag-${flag}`}><div className="overlay-plate"><strong className="overlay-title">{message || `${flag} flag`}</strong><span>Race control</span></div></div>;
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

  const selected = state?.session?.drivers.find((driver) => driver.carIdx === state.graphics.selectedDriverCarIdx);
  const rival = useMemo(() => {
    if (!state?.session || !selected) return undefined;
    return state.session.drivers.find((driver) => driver.position === selected.position + 1)
      ?? state.session.drivers.find((driver) => driver.position === selected.position - 1);
  }, [selected, state?.session]);

  if (!state?.session) return null;
  const activeSlots = new Set(state.graphics.activeSlots);
  const configFor = (slot: GraphicSlot) => state.graphics.slotConfig[slot] ?? {};
  const towerConfig = configFor("timing-tower");
  const defaultTowerRows = 12;
  const legacyRows = Number(towerConfig.rows ?? defaultTowerRows);
  const totalTowerCars = Number(towerConfig.totalCars ?? (packageId === "pri-hoosier-500" ? 20 : legacyRows));
  const visibleTowerRows = Number(towerConfig.visibleRows ?? legacyRows);
  const fixedTowerPositions = Number(towerConfig.fixedPositions ?? (packageId === "pri-hoosier-500" ? 5 : visibleTowerRows));

  return (
    <main>
      <OverlayLayer active={activeSlots.has("timing-tower")}>
        <TimingTower
          session={state.session}
          totalCars={totalTowerCars}
          visibleRows={visibleTowerRows}
          fixedPositions={fixedTowerPositions}
          packageId={packageId}
        />
      </OverlayLayer>
      <OverlayLayer active={activeSlots.has("driver-focus")}><DriverFocus driver={selected} config={configFor("driver-focus")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("race-status")}><RaceStatus name={state.session.name} track={state.session.trackName} lap={state.session.lap} total={state.session.totalLaps} flag={state.session.flag} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("battle")}><Battle selected={selected} rival={rival} label={String(configFor("battle").label ?? "Battle for position")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("flag")}><FlagOverlay flag={state.session.flag} message={String(configFor("flag").message ?? "")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("lower-third")}><LowerThird headline={String(configFor("lower-third").headline ?? "Race control")} detail={String(configFor("lower-third").detail ?? "")} /></OverlayLayer>
    </main>
  );
}
