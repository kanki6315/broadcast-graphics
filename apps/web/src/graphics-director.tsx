import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronRight,
  KeyRound,
  LogOut,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatLapTime, type GraphicPackageManifest, type GraphicSlot } from "@racecontrol/protocol";
import { useLiveState } from "./use-live-state";

type DirectorProps = {
  onManageAccess: () => void;
  onLogout: () => Promise<void>;
};

function Widget({ title, active = false, unavailable = false, className = "", children }: {
  title: string;
  active?: boolean;
  unavailable?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`graphics-widget${active ? " is-on-air" : ""}${unavailable ? " is-unavailable" : ""} ${className}`}>
      <header><h2>{title}</h2><span>{unavailable ? "Not installed" : active ? "On air" : "Off"}</span></header>
      {children}
    </section>
  );
}

function ShowHide({ active, disabled = false, onShow, onHide }: {
  active: boolean;
  disabled?: boolean;
  onShow?: () => void;
  onHide?: () => void;
}) {
  return (
    <div className="show-hide-controls">
      <button className={active ? "is-selected" : ""} disabled={disabled} onClick={onShow}>Show</button>
      <button className={!active ? "is-selected is-hide" : "is-hide"} disabled={disabled} onClick={onHide}>Hide</button>
    </div>
  );
}

function Stepper({ label, value, min, max, disabled = false, onChange, extras }: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  extras?: ReactNode;
}) {
  return (
    <div className="widget-stepper-row">
      <span>{label}</span>
      <div className="widget-stepper">
        <button disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Decrease ${label}`}>−</button>
        <output>{value}</output>
        <button disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Increase ${label}`}>+</button>
        {extras}
      </div>
    </div>
  );
}

function PlaceholderWidget({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Widget title={title} unavailable className={className}>
      <ShowHide active={false} disabled />
      <fieldset disabled className="placeholder-controls">{children}</fieldset>
    </Widget>
  );
}

export function GraphicsDirector({ onManageAccess, onLogout }: DirectorProps) {
  const { state, socketConnected, command } = useLiveState("control");
  const [packages, setPackages] = useState<GraphicPackageManifest[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    fetch("/api/packages").then((response) => response.json()).then(setPackages).catch(() => setPackages([]));
  }, []);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  if (!state) {
    return <main className="loading-screen"><img className="loading-brand-mark" src="/brand/gantry-mark.svg" alt="" /><h1>Connecting to graphics director</h1><p>The board will recover automatically when race control responds.</p></main>;
  }

  const session = state.session;
  const telemetryHealthy = socketConnected && state.connection === "connected";
  const activePackage = packages.find((candidate) => candidate.id === state.graphics.packageId) ?? packages[0];
  const active = (slot: GraphicSlot) => state.graphics.activeSlots.includes(slot);
  const show = (slot: GraphicSlot) => command({ type: "graphics.take", slot });
  const hide = (slot: GraphicSlot) => command({ type: "graphics.clear", slot });
  const config = (slot: GraphicSlot) => state.graphics.slotConfig[slot] ?? {};
  const setConfig = (slot: GraphicSlot, key: string, value: string | number | boolean) => command({ type: "graphics.config.set", slot, key, value });

  const focusConfig = config("driver-focus");
  const focusMode = String(focusConfig.targetMode ?? "followed");
  const followedDriver = session?.drivers.find((driver) => driver.carIdx === state.graphics.selectedDriverCarIdx);
  const manualDriver = session?.drivers.find((driver) => driver.carIdx === Number(focusConfig.manualCarIdx));
  const primaryDriver = focusMode === "manual" ? manualDriver : followedDriver;
  const compareEnabled = Boolean(focusConfig.compareEnabled);
  const compareDriver = session?.drivers.find((driver) => driver.carIdx === Number(focusConfig.compareCarIdx))
    ?? session?.drivers.find((driver) => driver.carIdx !== primaryDriver?.carIdx);
  const contentOptions = [
    ["showTeam", "Team", true],
    ["showBestLast", "Best / Last", true],
    ["showBestCurrent", "Best / Current", false],
    ["showPitStop", "Pit stop", false],
    ["showHometown", "Hometown", false],
    ["showPosition", "Position", true],
    ["showGap", "Gap", true],
    ["showClub", "Club", false],
    ["showManufacturer", "Manufacturer", false],
  ] as const;

  const battleConfig = config("battle");
  const battleMode = String(battleConfig.positionMode ?? "followed");
  const followedPosition = followedDriver?.position ?? 1;
  const fixedPosition = Number(battleConfig.startPosition ?? 1);
  const effectiveBattlePosition = Math.max(1, battleMode === "followed" ? followedPosition : fixedPosition);
  const carsBehind = Math.max(1, Number(battleConfig.carsBehind ?? 3));
  const fieldSize = Math.max(1, session?.drivers.length ?? 1);
  const setBattlePosition = (position: number) => {
    setConfig("battle", "positionMode", "fixed");
    setConfig("battle", "startPosition", Math.max(1, Math.min(fieldSize, position)));
  };

  const towerConfig = config("timing-tower");
  const towerRows = Math.max(1, Number(towerConfig.rows ?? 12));
  const towerPage = Math.max(1, Number(towerConfig.page ?? 1));
  const towerPages = Math.max(1, Math.ceil((session?.drivers.length ?? 0) / towerRows));
  const nextTowerPage = () => setConfig("timing-tower", "page", towerPage >= towerPages ? 1 : towerPage + 1);

  const compareGap = (() => {
    if (!primaryDriver || !compareDriver) return "—";
    const lapDifference = Math.abs(primaryDriver.lapsCompleted - compareDriver.lapsCompleted);
    if (lapDifference > 0) return `${lapDifference}L`;
    const first = primaryDriver.gapToLeader ?? primaryDriver.interval;
    const second = compareDriver.gapToLeader ?? compareDriver.interval;
    return first == null || second == null ? "—" : `+${Math.abs(first - second).toFixed(3)}`;
  })();

  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try { await onLogout(); }
    catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Sign out failed. This session remains active.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="graphics-director-shell">
      <header className="director-masthead">
        <div className="director-brand"><img src="/brand/gantry-mark.svg" alt="" /><div><strong>Gantry / Graphics</strong><span>Fixed presentation board</span></div></div>
        <div className={`director-status ${telemetryHealthy ? "is-good" : "is-bad"}`}>
          {telemetryHealthy ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <span>{telemetryHealthy ? "Connected" : state.connection}</span>
        </div>
        <div className="director-session"><strong>{session?.trackName ?? "Waiting for session"}</strong><span>{session ? `Lap ${session.lap}${session.totalLaps ? ` / ${session.totalLaps}` : ""} · ${session.flag}` : "No telemetry received"}</span></div>
        <label className="director-package"><span>Package</span><select value={state.graphics.packageId} onChange={(event) => command({ type: "graphics.package.set", packageId: event.target.value })}>{packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <nav className="director-nav"><a href="/timing">Timing <ChevronRight aria-hidden="true" /></a><button onClick={onManageAccess}><KeyRound aria-hidden="true" />Access</button><button onClick={() => void logout()} disabled={loggingOut}><LogOut aria-hidden="true" />{loggingOut ? "Signing out" : "Sign out"}</button></nav>
        {logoutError && <span className="director-error" role="alert">{logoutError}</span>}
      </header>

      <main className="graphics-board">
        <Widget title="Race status" active={active("race-status")} className="widget-race-status">
          <ShowHide active={active("race-status")} onShow={() => show("race-status")} onHide={() => hide("race-status")} />
          <div className="widget-fields"><label><span>Mode</span><input readOnly value={session?.type ?? "—"} /></label><label><span>Laps</span><input readOnly value={session ? `${session.lap} / ${session.totalLaps ?? "—"}` : "—"} /></label><label className="widget-check"><input type="checkbox" checked readOnly />Auto</label></div>
        </Widget>

        <PlaceholderWidget title="Weather" className="widget-weather"><label className="placeholder-note">Weather graphic planned</label></PlaceholderWidget>

        <Widget title="Flag" active={active("flag")} className="widget-flag">
          <ShowHide active={active("flag")} onShow={() => show("flag")} onHide={() => hide("flag")} />
          <div className="widget-fields"><label><span>Flag</span><input readOnly value={`${session?.flag ?? "No"} flag`} /></label><label><span>Message</span><input value={String(config("flag").message ?? "")} onChange={(event) => setConfig("flag", "message", event.target.value)} placeholder="Automatic label" /></label><label className="widget-check"><input type="checkbox" checked readOnly />Auto</label></div>
        </Widget>

        <Widget title="Timing tower" active={active("timing-tower")} className="widget-timing-tower">
          <ShowHide active={active("timing-tower")} onShow={() => show("timing-tower")} onHide={() => hide("timing-tower")} />
          <div className="widget-fields is-two-column"><label><span>Rows</span><input type="number" min={5} max={20} value={towerRows} onChange={(event) => setConfig("timing-tower", "rows", Number(event.target.value))} /></label><label><span>Mode</span><input readOnly value="Interval" /></label><label><span>Page</span><input readOnly value={`${Math.min(towerPage, towerPages)} / ${towerPages}`} /></label><button className="widget-secondary" onClick={nextTowerPage}>Next page</button><label className="widget-check"><input type="checkbox" checked readOnly />Auto update</label></div>
        </Widget>

        <Widget title="Driver info" active={active("driver-focus")} className="widget-driver-info">
          <ShowHide active={active("driver-focus")} onShow={() => show("driver-focus")} onHide={() => hide("driver-focus")} />
          <div className="driver-source-controls"><div role="group" aria-label="Driver info source"><button className={focusMode === "followed" ? "is-selected" : ""} onClick={() => setConfig("driver-focus", "targetMode", "followed")}>Followed</button><button className={focusMode === "manual" ? "is-selected" : ""} onClick={() => setConfig("driver-focus", "targetMode", "manual")}>Manual</button></div><select disabled={focusMode !== "manual"} value={manualDriver?.carIdx ?? ""} onChange={(event) => setConfig("driver-focus", "manualCarIdx", Number(event.target.value))}><option value="">Choose driver</option>{session?.drivers.map((driver) => <option key={driver.carIdx} value={driver.carIdx}>#{driver.carNumber} {driver.name}</option>)}</select></div>
          <div className="driver-info-identity"><strong>{primaryDriver ? `#${primaryDriver.carNumber} ${primaryDriver.name}` : "No driver selected"}</strong><span>{focusMode === "followed" ? "From timing director" : "Manual presentation target"}</span></div>
          <div className="driver-content-options" aria-label="Driver info content">
            {contentOptions.map(([key, label, supported]) => {
              const defaultOn = key === "showTeam" || key === "showPosition" || key === "showGap";
              const selected = Boolean(focusConfig[key] ?? defaultOn);
              return <button key={key} disabled={!supported} className={selected ? "is-selected" : ""} onClick={() => setConfig("driver-focus", key, !selected)}>{label}{!supported && <small>Planned</small>}</button>;
            })}
          </div>
          <div className="compare-controls">
            <label className="compare-toggle"><span>Compare</span><input type="checkbox" checked={compareEnabled} onChange={(event) => setConfig("driver-focus", "compareEnabled", event.target.checked)} /></label>
            <label><span>Driver A</span><input readOnly value={`${focusMode === "followed" ? "Followed" : "Manual"} · ${primaryDriver ? `#${primaryDriver.carNumber} ${primaryDriver.name}` : "None"}`} /></label>
            <label><span>Driver B</span><select disabled={!compareEnabled} value={compareDriver?.carIdx ?? ""} onChange={(event) => setConfig("driver-focus", "compareCarIdx", Number(event.target.value))}>{session?.drivers.filter((driver) => driver.carIdx !== primaryDriver?.carIdx).map((driver) => <option key={driver.carIdx} value={driver.carIdx}>Manual · #{driver.carNumber} {driver.name}</option>)}</select></label>
          </div>
          {compareEnabled && <div className="compare-preview"><span><b>{primaryDriver?.carNumber ?? "—"}</b>{primaryDriver?.name ?? "Driver A"}</span><strong><small>Gap</small>{compareGap}</strong><span><b>{compareDriver?.carNumber ?? "—"}</b>{compareDriver?.name ?? "Driver B"}</span></div>}
        </Widget>

        <Widget title="Battle" active={active("battle")} className="widget-battle">
          <ShowHide active={active("battle")} onShow={() => show("battle")} onHide={() => hide("battle")} />
          <Stepper label="Start position" value={effectiveBattlePosition} min={1} max={fieldSize} onChange={setBattlePosition} extras={<><button className={battleMode === "fixed" && fixedPosition === 1 ? "is-selected" : ""} onClick={() => setBattlePosition(1)}>P1</button><button className={battleMode === "followed" ? "is-selected" : ""} onClick={() => setConfig("battle", "positionMode", "followed")} aria-label="Follow timing selection">F</button></>} />
          <Stepper label="Cars behind" value={carsBehind} min={1} max={9} onChange={(value) => setConfig("battle", "carsBehind", value)} />
          <output className="battle-range">Showing P{effectiveBattlePosition}–P{Math.min(fieldSize, effectiveBattlePosition + carsBehind)}</output>
        </Widget>

        <PlaceholderWidget title="Grid" className="widget-grid"><button className="widget-secondary" disabled>Next page</button><output>Page 1 / —</output></PlaceholderWidget>
        <PlaceholderWidget title="Results" className="widget-results"><button className="widget-secondary" disabled>Next page</button><output>Page 1 / —</output></PlaceholderWidget>

        <PlaceholderWidget title="Fastest lap" className="widget-fastest"><label className="widget-check"><input type="checkbox" />Auto show</label><label><span>Duration</span><input value="8s" readOnly /></label></PlaceholderWidget>

        <Widget title="Announcement" active={active("lower-third")} className="widget-announcement">
          <ShowHide active={active("lower-third")} onShow={() => show("lower-third")} onHide={() => hide("lower-third")} />
          <div className="widget-fields"><label><span>Headline</span><input value={String(config("lower-third").headline ?? "Race control")} onChange={(event) => setConfig("lower-third", "headline", event.target.value)} /></label><label><span>Detail</span><input value={String(config("lower-third").detail ?? "")} onChange={(event) => setConfig("lower-third", "detail", event.target.value)} /></label></div>
        </Widget>

        <section className="graphics-global-controls"><h2>Global controls</h2><button className={confirmClear ? "is-confirming" : ""} onClick={() => { if (confirmClear) { command({ type: "graphics.clearAll" }); setConfirmClear(false); } else setConfirmClear(true); }}><AlertTriangle aria-hidden="true" /><span><strong>{confirmClear ? "Confirm clear" : "Clear all graphics"}</strong><small>{confirmClear ? "Press again within 3 seconds" : `${state.graphics.activeSlots.length} currently on air`}</small></span></button></section>
      </main>
    </div>
  );
}
