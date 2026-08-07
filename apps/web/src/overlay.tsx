import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
  return name.trim().split(/\s+/).at(-1) ?? name;
}

function TimingTower({ session, rows, page }: { session: SessionState; rows: number; page: number }) {
  const pageCount = Math.max(1, Math.ceil(session.drivers.length / rows));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const visibleDrivers = session.drivers.slice((currentPage - 1) * rows, currentPage * rows);
  const visibleDriverOrder = visibleDrivers.map((driver) => driver.carIdx).join(":");
  const rowElements = useRef(new Map<number, HTMLLIElement>());
  const previousTops = useRef(new Map<number, number>());

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

  return (
    <main>
      <OverlayLayer active={activeSlots.has("timing-tower")}><TimingTower session={state.session} rows={Number(configFor("timing-tower").rows ?? 12)} page={Number(configFor("timing-tower").page ?? 1)} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("driver-focus")}><DriverFocus driver={selected} compareDriver={compareDriver} config={focusConfig} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("race-status")}><RaceStatus name={state.session.name} track={state.session.trackName} lap={state.session.lap} total={state.session.totalLaps} flag={state.session.flag} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("battle")}><Battle drivers={battleDrivers} label={String(battleConfig.label ?? `Battle P${battleStart}–P${battleEnd}`)} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("flag")}><FlagOverlay flag={state.session.flag} message={String(configFor("flag").message ?? "")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("lower-third")}><LowerThird headline={String(configFor("lower-third").headline ?? "Race control")} detail={String(configFor("lower-third").detail ?? "")} /></OverlayLayer>
    </main>
  );
}
