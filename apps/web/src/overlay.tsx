import { useEffect, useMemo } from "react";
import { formatLapTime, isGraphicSlot, type DriverState, type GraphicSlot, type SessionState } from "@racecontrol/protocol";
import { useLiveState } from "./use-live-state";

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

function TimingTower({ session, rows }: { session: SessionState; rows: number }) {
  return (
    <div className="overlay-surface timing-overlay">
      <div className="tower-brand overlay-title">
        <strong>APEX</strong>
        <span>RACE CONTROL</span>
      </div>
      <header className="tower-session overlay-title">
        <strong>{session.type}</strong>
        <span>{session.totalLaps ? `LAP ${session.lap} / ${session.totalLaps}` : formatSessionClock(session.timeRemaining)}</span>
      </header>
      <div className="tower-columns overlay-title"><span>Pos</span><span>Car</span><span>Driver</span><strong>Interval</strong></div>
      <ol className="overlay-plate">
        {session.drivers.slice(0, rows).map((driver) => (
          <li key={driver.carIdx} className="overlay-rule">
            <span className="position-chip">{driver.position}</span>
            <span className="overlay-accent overlay-number">{driver.carNumber}</span>
            <strong>{driver.name}</strong>
            <span>{driver.interval == null ? "Leader" : `+${driver.interval.toFixed(3)}`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DriverFocus({ driver, config }: { driver?: DriverState; config: Record<string, string | number | boolean> }) {
  if (!driver) return null;
  const metric = String(config.metric ?? "bestLap");
  const metricValue = metric === "interval" ? (driver.interval == null ? "Leader" : `+${driver.interval.toFixed(3)}`) : formatLapTime(metric === "lastLap" ? driver.lastLap : driver.bestLap);
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
  return <div className="overlay-surface battle-overlay overlay-plate"><span className="overlay-title">{label}</span><div><b className="overlay-accent">{selected.carNumber}</b><strong>{selected.name}</strong><em>P{selected.position}</em></div><div><b>{rival.carNumber}</b><strong>{rival.name}</strong><em>{rival.interval == null ? "—" : `+${rival.interval.toFixed(3)}`}</em></div></div>;
}

function FlagOverlay({ flag, message }: { flag: string; message: string }) {
  return <div className={`overlay-surface flag-overlay flag-${flag}`}><div className="overlay-plate"><strong className="overlay-title">{message || `${flag} flag`}</strong><span>Race control</span></div></div>;
}

function LowerThird({ headline, detail }: { headline: string; detail: string }) {
  return <div className="overlay-surface lower-overlay overlay-plate"><span className="overlay-accent lower-mark" /><div><strong className="overlay-title">{headline}</strong><span>{detail}</span></div></div>;
}

export function OverlayApp() {
  const { state } = useLiveState("overlay");
  const pathSlot = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "timing-tower";
  const slot: GraphicSlot = isGraphicSlot(pathSlot) ? pathSlot : "timing-tower";
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
  const isActive = state.graphics.activeSlots.includes(slot);
  const config = state.graphics.slotConfig[slot] ?? {};

  return (
    <main className={`overlay-canvas ${isActive ? "is-active" : ""}`} aria-hidden={!isActive}>
      {slot === "timing-tower" && <TimingTower session={state.session} rows={Number(config.rows ?? 12)} />}
      {slot === "driver-focus" && <DriverFocus driver={selected} config={config} />}
      {slot === "race-status" && <RaceStatus name={state.session.name} track={state.session.trackName} lap={state.session.lap} total={state.session.totalLaps} flag={state.session.flag} />}
      {slot === "battle" && <Battle selected={selected} rival={rival} label={String(config.label ?? "Battle for position")} />}
      {slot === "flag" && <FlagOverlay flag={state.session.flag} message={String(config.message ?? "")} />}
      {slot === "lower-third" && <LowerThird headline={String(config.headline ?? "Race control")} detail={String(config.detail ?? "")} />}
    </main>
  );
}
