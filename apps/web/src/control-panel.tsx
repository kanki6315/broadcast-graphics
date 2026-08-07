import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleStop,
  Crosshair,
  Flag,
  Layers3,
  KeyRound,
  LogOut,
  PackageOpen,
  Radio,
  TimerReset,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  formatLapTime,
  graphicSlots,
  type GraphicFieldDefinition,
  type GraphicPackageManifest,
  type GraphicSlot,
} from "@racecontrol/protocol";
import { useLiveState } from "./use-live-state";

const slotIcons: Record<GraphicSlot, typeof Radio> = {
  "timing-tower": Layers3,
  "race-status": TimerReset,
  "driver-focus": Crosshair,
  battle: Radio,
  flag: Flag,
  "lower-third": PackageOpen,
};

function FieldControl({ field, value, onChange }: {
  field: GraphicFieldDefinition;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="field toggle-field">
        <span>{field.label}</span>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span className="toggle-track" aria-hidden="true"><span /></span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        type={field.type === "number" ? "number" : "text"}
        min={field.min}
        max={field.max}
        value={String(value)}
        onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </label>
  );
}

export function ControlPanel({ onManageAccess, onLogout }: { onManageAccess: () => void; onLogout: () => Promise<void> }) {
  const { state, socketConnected, command } = useLiveState("control");
  const [packages, setPackages] = useState<GraphicPackageManifest[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

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

  useEffect(() => {
    fetch("/api/packages").then((response) => response.json()).then(setPackages).catch(() => setPackages([]));
  }, []);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const activePackage = packages.find((candidate) => candidate.id === state?.graphics.packageId) ?? packages[0];
  const armedSlot = state?.graphics.armedSlot ?? "timing-tower";
  const slotDefinition = activePackage?.slots[armedSlot];
  const selectedDriver = state?.session?.drivers.find((driver) => driver.carIdx === state.graphics.selectedDriverCarIdx);
  const currentSlot = state?.graphics.activeSlots.at(-1) ?? null;
  const nextSlot = armedSlot !== currentSlot ? armedSlot : null;
  const fastestCarIdx = useMemo(() => {
    const drivers = state?.session?.drivers ?? [];
    return [...drivers].filter((driver) => driver.bestLap != null).sort((a, b) => a.bestLap! - b.bestLap!)[0]?.carIdx;
  }, [state?.session?.drivers]);

  if (!state) {
    return (
      <main className="loading-screen">
        <Radio aria-hidden="true" />
        <h1>Connecting to race control</h1>
        <p>Start the server at port 8787, then this desk will recover automatically.</p>
      </main>
    );
  }

  const telemetryHealthy = socketConnected && state.connection === "connected";
  const isSimulated = state.session?.id.toLowerCase().includes("sim") ?? false;

  return (
    <div className="control-shell">
      <header className="masthead">
        <div className="brand-block">
          <span className="registration-mark" aria-hidden="true" />
          <div><strong>Broadcast Graphics</strong><span>Live control</span></div>
        </div>
        <div className={`connection-plate ${telemetryHealthy ? "is-good" : "is-bad"}`}>
          {telemetryHealthy ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <div><strong>{telemetryHealthy ? "Connected" : state.connection}</strong><span>{telemetryHealthy ? "Data feed current" : "Check telemetry client"}</span></div>
        </div>
        <div className="session-plate">
          <strong>{isSimulated ? `Simulated · ${state.session?.name}` : state.session?.name ?? "Waiting for session"}</strong>
          <span>{state.session ? `${state.session.trackName} · Lap ${state.session.lap}${state.session.totalLaps ? ` / ${state.session.totalLaps}` : ""}` : "No telemetry received"}</span>
        </div>
        <div className="package-account-cell">
          <label className="package-picker">
            <span>Client package</span>
            <select value={state.graphics.packageId} onChange={(event) => command({ type: "graphics.package.set", packageId: event.target.value })}>
              {packages.map((item) => <option key={item.id} value={item.id}>{item.clientName} / {item.name}</option>)}
            </select>
          </label>
          <div className="account-actions"><button onClick={onManageAccess}><KeyRound aria-hidden="true" />Access</button><button onClick={() => void logout()} disabled={loggingOut}><LogOut aria-hidden="true" />{loggingOut ? "Signing out" : "Sign out"}</button></div>
          {logoutError && <span className="account-error" role="alert">{logoutError}</span>}
        </div>
      </header>

      <main className="production-grid">
        <section className="timing-director" aria-labelledby="timing-title">
          <div className="section-heading">
            <div><h1 id="timing-title">Timing director</h1><p>Select the driver worth following. This focus is shared by driver-dependent graphics.</p></div>
            <div className={`flag-plate flag-${state.session?.flag ?? "green"}`}><Flag aria-hidden="true" /><strong>{state.session?.flag ?? "No flag"}</strong></div>
          </div>
          <div className="timing-table-wrap">
            <table className="timing-table">
              <thead><tr><th>Pos</th><th>No.</th><th>Driver</th><th>Gap</th><th>Last lap</th><th>Best lap</th><th>Status</th></tr></thead>
              <tbody>
                {state.session?.drivers.map((driver) => {
                  const focused = driver.carIdx === state.graphics.selectedDriverCarIdx;
                  const fastest = driver.carIdx === fastestCarIdx;
                  return (
                    <tr key={driver.carIdx} className={focused ? "is-focused" : ""}>
                      <td><button className="driver-select" onClick={() => command({ type: "focus.set", carIdx: driver.carIdx })} aria-label={`Focus ${driver.name}`} aria-pressed={focused}>{driver.position}</button></td>
                      <td><span className="car-number">{driver.carNumber}</span></td>
                      <td><button className="driver-name" onClick={() => command({ type: "focus.set", carIdx: driver.carIdx })}><strong>{driver.name}</strong><span>{driver.team}</span></button></td>
                      <td className="numeric">{driver.position === 1 ? "Leader" : driver.lapsBehindLeader > 0 ? `+${driver.lapsBehindLeader}L` : (driver.gapToLeader ?? driver.interval) == null ? "—" : `+${(driver.gapToLeader ?? driver.interval)!.toFixed(3)}`}</td>
                      <td className="numeric">{formatLapTime(driver.lastLap)}</td>
                      <td className={`numeric ${fastest ? "fastest" : ""}`}>{formatLapTime(driver.bestLap)}</td>
                      <td><span className={`status-tag ${focused ? "focus" : driver.trackStatus === "pit" ? "pit" : fastest ? "fastest-tag" : "running"}`}>{focused ? "Focus" : driver.trackStatus === "pit" ? "Pit" : driver.trackStatus === "off-track" ? "Off track" : driver.trackStatus === "not-in-world" ? "Out" : driver.trackStatus === "retired" ? "Retired" : fastest ? "Fastest" : "Running"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="focus-ledger">
            <div><span>Focused driver</span><strong>{selectedDriver ? `#${selectedDriver.carNumber} ${selectedDriver.name}` : "None"}</strong></div>
            <div><span>Position</span><strong>{selectedDriver ? `P${selectedDriver.position}` : "—"}</strong></div>
            <div><span>Gap</span><strong>{selectedDriver?.position === 1 ? "Leader" : selectedDriver && selectedDriver.lapsBehindLeader > 0 ? `+${selectedDriver.lapsBehindLeader}L` : (selectedDriver?.gapToLeader ?? selectedDriver?.interval) == null ? "—" : `+${(selectedDriver?.gapToLeader ?? selectedDriver?.interval)!.toFixed(3)}`}</strong></div>
            <div><span>Best lap</span><strong>{formatLapTime(selectedDriver?.bestLap ?? null)}</strong></div>
            <div className="future-hook"><Crosshair aria-hidden="true" /><span>Camera focus hook ready</span></div>
          </div>
        </section>

        <aside className="production-rail">
          <section className="cue-sheet" aria-labelledby="cue-title">
            <div className="rail-heading"><h2 id="cue-title">Graphic cues</h2><span>{state.graphics.activeSlots.length} on air</span></div>
            <div className="cue-sequence">
              <div className="sequence-plate is-current">
                <span>Current / on air</span>
                <strong>{currentSlot ? activePackage?.slots[currentSlot].label : "No graphic"}</strong>
                {currentSlot && <button onClick={() => command({ type: "graphics.clear", slot: currentSlot })}>Clear</button>}
              </div>
              <div className="sequence-plate is-next">
                <span>Next cue</span>
                <strong>{nextSlot ? activePackage?.slots[nextSlot].label : "Select another cue"}</strong>
                {nextSlot && <button onClick={() => command({ type: "graphics.take", slot: nextSlot })}>Take</button>}
              </div>
            </div>
            <div className="cue-list">
              {graphicSlots.map((slot, index) => {
                const definition = activePackage?.slots[slot];
                const Icon = slotIcons[slot];
                const active = state.graphics.activeSlots.includes(slot);
                const armed = armedSlot === slot;
                return (
                  <button key={slot} className={`cue-row ${active ? "is-live" : ""} ${armed ? "is-armed" : ""}`} onClick={() => command({ type: "graphics.arm", slot })} aria-pressed={armed}>
                    <span className="cue-key">{index + 1}</span><Icon aria-hidden="true" />
                    <span className="cue-copy"><strong>{definition?.label ?? slot}</strong><span>{active ? "Live / on air" : armed ? "Selected" : "Off"}</span></span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="graphic-inspector" aria-labelledby="inspector-title">
            <div className="rail-heading"><h2 id="inspector-title">{slotDefinition?.label ?? "Graphic"}</h2><span>{activePackage?.name ?? "Loading package"}</span></div>
            <p>{slotDefinition?.description}</p>
            <div className="field-grid">
              {slotDefinition?.fields.map((field) => {
                const stored = state.graphics.slotConfig[armedSlot]?.[field.key];
                return <FieldControl key={field.key} field={field} value={stored ?? field.default} onChange={(value) => command({ type: "graphics.config.set", slot: armedSlot, key: field.key, value })} />;
              })}
            </div>
            <div className="take-controls">
              {state.graphics.activeSlots.includes(armedSlot) ? (
                <button className="clear-cue" onClick={() => command({ type: "graphics.clear", slot: armedSlot })}><CircleStop aria-hidden="true" />Clear graphic</button>
              ) : (
                <button className="take-cue" onClick={() => command({ type: "graphics.take", slot: armedSlot })}><Check aria-hidden="true" />Take graphic <kbd>Enter</kbd></button>
              )}
            </div>
          </section>

          <section className="event-log" aria-labelledby="event-title">
            <div className="rail-heading"><h2 id="event-title">Event log</h2><span>Latest first</span></div>
            <ol>{state.events.slice(0, 5).map((event) => <li key={event.id}><time>{new Date(event.at).toLocaleTimeString([], { hour12: false })}</time><span>{event.message}</span></li>)}</ol>
          </section>

          <button className={`clear-all ${confirmClear ? "is-confirming" : ""}`} onClick={() => {
            if (confirmClear) { command({ type: "graphics.clearAll" }); setConfirmClear(false); }
            else setConfirmClear(true);
          }}>
            <AlertTriangle aria-hidden="true" /><span><strong>{confirmClear ? "Confirm clear" : "Clear all graphics"}</strong><small>{confirmClear ? "Press again within 3 seconds" : "Removes every on-air overlay"}</small></span>
          </button>
        </aside>
      </main>
    </div>
  );
}
