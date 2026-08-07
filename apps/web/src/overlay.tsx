import { useEffect, useMemo, type ReactNode } from "react";
import { formatLapTime, type DriverState, type GraphicSlot } from "@racecontrol/protocol";
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

function TimingTower({ drivers, rows }: { drivers: DriverState[]; rows: number }) {
  return (
    <div className="overlay-surface timing-overlay">
      <header className="overlay-title"><span>Position</span><strong>Interval</strong></header>
      <ol className="overlay-plate">
        {drivers.slice(0, rows).map((driver) => (
          <li key={driver.carIdx} className="overlay-rule">
            <span className="overlay-accent position-chip">{driver.position}</span>
            <span className="overlay-number">{driver.carNumber}</span>
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
    <div className="overlay-surface lower-overlay overlay-plate">
      <span className="overlay-accent focus-number">{driver.carNumber}</span>
      <div className="focus-identity"><strong className="overlay-title">{driver.name}</strong><span>{String(config.subtitle || driver.team)}</span></div>
      <div className="focus-position"><span>Position</span><strong>P{driver.position}</strong></div>
      <div className="focus-metric"><span>{metric.replace(/([A-Z])/g, " $1")}</span><strong>{metricValue}</strong></div>
    </div>
  );
}

function RaceStatus({ name, track, lap, total, flag }: { name: string; track: string; lap: number; total: number | null; flag: string }) {
  return <div className="overlay-surface status-overlay overlay-plate"><div><strong className="overlay-title">{name}</strong><span>{track}</span></div><div><span>Lap</span><strong>{lap}{total ? ` / ${total}` : ""}</strong></div><div className="overlay-accent flag-chip">{flag}</div></div>;
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

  return (
    <main>
      <OverlayLayer active={activeSlots.has("timing-tower")}><TimingTower drivers={state.session.drivers} rows={Number(configFor("timing-tower").rows ?? 10)} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("driver-focus")}><DriverFocus driver={selected} config={configFor("driver-focus")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("race-status")}><RaceStatus name={state.session.name} track={state.session.trackName} lap={state.session.lap} total={state.session.totalLaps} flag={state.session.flag} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("battle")}><Battle selected={selected} rival={rival} label={String(configFor("battle").label ?? "Battle for position")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("flag")}><FlagOverlay flag={state.session.flag} message={String(configFor("flag").message ?? "")} /></OverlayLayer>
      <OverlayLayer active={activeSlots.has("lower-third")}><LowerThird headline={String(configFor("lower-third").headline ?? "Race control")} detail={String(configFor("lower-third").detail ?? "")} /></OverlayLayer>
    </main>
  );
}
