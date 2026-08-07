import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  AlertTriangle,
  Camera,
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

type CameraMenuState = {
  driverCarIdx: number;
  x: number;
  y: number;
  returnFocus: HTMLElement | null;
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
  const [cameraMenu, setCameraMenu] = useState<CameraMenuState | null>(null);
  const cameraMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!cameraMenu) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!cameraMenuRef.current?.contains(event.target as Node)) setCameraMenu(null);
    };
    const dismissAndRestoreFocus = () => {
      const shouldRestoreFocus = cameraMenuRef.current?.contains(document.activeElement);
      const returnFocus = cameraMenu.returnFocus;
      setCameraMenu(null);
      if (shouldRestoreFocus) window.requestAnimationFrame(() => returnFocus?.focus());
    };
    const dismissForResize = () => dismissAndRestoreFocus();
    const dismissForScroll = (event: Event) => {
      if (!cameraMenuRef.current?.contains(event.target as Node)) dismissAndRestoreFocus();
    };
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", dismissForResize);
    window.addEventListener("scroll", dismissForScroll, true);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", dismissForResize);
      window.removeEventListener("scroll", dismissForScroll, true);
    };
  }, [cameraMenu]);

  useLayoutEffect(() => {
    const menu = cameraMenuRef.current;
    if (!cameraMenu || !menu) return;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(cameraMenu.x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(cameraMenu.y, window.innerHeight - bounds.height - 8))}px`;
    const firstAction = menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    (firstAction ?? menu).focus();
  }, [cameraMenu]);

  function openCameraMenu(driverCarIdx: number, x: number, y: number, returnFocus: HTMLElement | null) {
    setCameraMenu({ driverCarIdx, x, y, returnFocus });
  }

  function handleDriverContextMenu(driverCarIdx: number, event: ReactMouseEvent<HTMLTableRowElement>) {
    event.preventDefault();
    const activeElement = document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)
      ? document.activeElement
      : event.currentTarget.querySelector<HTMLElement>(".driver-name");
    openCameraMenu(driverCarIdx, event.clientX, event.clientY, activeElement);
  }

  function handleDriverMenuKey(driverCarIdx: number, event: ReactKeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    const bounds = target.getBoundingClientRect();
    openCameraMenu(driverCarIdx, bounds.left + 24, bounds.bottom + 4, target);
  }

  function handleCameraMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!cameraMenu) return;
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      const returnFocus = cameraMenu.returnFocus;
      setCameraMenu(null);
      window.requestAnimationFrame(() => returnFocus?.focus());
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const actions = Array.from(cameraMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (actions.length === 0) return;
    event.preventDefault();
    const currentIndex = actions.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? actions.length - 1
        : event.key === "ArrowDown" ? (currentIndex + 1) % actions.length
          : (currentIndex - 1 + actions.length) % actions.length;
    actions[nextIndex].focus();
  }

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
  const cameraGroups = state.camera.groups.filter((group) => !group.isScenic && group.cameras.length > 0);
  const activeCameraGroup = state.camera.groups.find((group) => group.number === state.camera.activeGroup);
  const cameraReady = state.camera.controller === "ready" && cameraGroups.length > 0;
  const cameraStatus = state.camera.pendingCommandId
    ? state.camera.lastMessage ?? "Sending camera command"
    : state.camera.lastMessage
      ?? (state.camera.controller === "ready" ? "Camera controller ready" : state.camera.controller === "unavailable" ? "Live iRacing source required" : "Telemetry client disconnected");

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
            <div><h1 id="timing-title">Timing director</h1><p>Select a driver to share focus with graphics and the live camera. Right-click a driver to choose a specific camera group.</p></div>
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
                    <tr
                      key={driver.carIdx}
                      className={`${focused ? "is-focused" : ""}${cameraMenu?.driverCarIdx === driver.carIdx ? " has-camera-menu" : ""}`}
                      onContextMenu={(event) => handleDriverContextMenu(driver.carIdx, event)}
                      onKeyDown={(event) => handleDriverMenuKey(driver.carIdx, event)}
                    >
                      <td><button className="driver-select" onClick={() => command({ type: "focus.set", carIdx: driver.carIdx })} aria-label={`${cameraReady ? "Focus graphics and take camera for" : "Focus graphics on"} ${driver.name}`} aria-pressed={focused}>{driver.position}</button></td>
                      <td><span className="car-number">{driver.carNumber}</span></td>
                      <td><button className="driver-name" onClick={() => command({ type: "focus.set", carIdx: driver.carIdx })} aria-label={`${cameraReady ? "Focus graphics and take camera for" : "Focus graphics on"} ${driver.name}`}><strong>{driver.name}</strong><span>{driver.team}</span></button></td>
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
            <div className={`camera-control camera-${state.camera.controller}`}>
              <div className="camera-control-heading">
                <span><Camera aria-hidden="true" />Camera groups</span>
                <span className={`camera-status is-${state.camera.lastResult ?? state.camera.controller}`} role="status">
                  {cameraStatus}{activeCameraGroup ? ` · Active ${activeCameraGroup.name}` : ""}
                </span>
              </div>
              {cameraGroups.length > 0 ? (
                <div className="camera-group-grid" role="group" aria-label="Take camera group" aria-busy={Boolean(state.camera.pendingCommandId)}>
                  {cameraGroups.map((group) => {
                    const isSelected = group.number === state.camera.selectedGroup;
                    const isActive = group.number === state.camera.activeGroup;
                    return (
                      <button
                        key={group.number}
                        type="button"
                        className={`camera-group-button${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                        disabled={!cameraReady || !selectedDriver || Boolean(state.camera.pendingCommandId)}
                        onClick={() => command({ type: "camera.group.take", cameraGroup: group.number })}
                        aria-label={`Take ${group.name} camera${selectedDriver ? ` for ${selectedDriver.name}` : ""}`}
                        aria-pressed={isActive}
                      >
                        <strong>{group.name}</strong>
                        <span>{isActive ? "Active" : isSelected ? "Selected" : "Take"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : <p className="camera-empty">No camera groups available</p>}
            </div>
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
      {cameraMenu && (() => {
        const driver = state.session?.drivers.find((candidate) => candidate.carIdx === cameraMenu.driverCarIdx);
        if (!driver) return null;
        return (
          <div
            ref={cameraMenuRef}
            className="driver-camera-menu"
            role="menu"
            aria-label={`Camera group for ${driver.name}`}
            aria-busy={Boolean(state.camera.pendingCommandId)}
            tabIndex={-1}
            style={{ left: cameraMenu.x, top: cameraMenu.y }}
            onKeyDown={handleCameraMenuKeyDown}
          >
            <div className="driver-camera-menu-heading">
              <span>Take camera for</span>
              <strong>#{driver.carNumber} {driver.name}</strong>
            </div>
            <div className="driver-camera-menu-actions">
              {cameraGroups.length > 0 ? cameraGroups.map((group) => (
                <button
                  key={group.number}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={group.number === state.camera.activeGroup && driver.carIdx === state.camera.activeCarIdx ? "is-active" : ""}
                  disabled={!cameraReady || Boolean(state.camera.pendingCommandId)}
                  onClick={() => {
                    const returnFocus = cameraMenu.returnFocus;
                    command({ type: "camera.driver.take", carIdx: driver.carIdx, cameraGroup: group.number });
                    setCameraMenu(null);
                    window.requestAnimationFrame(() => returnFocus?.focus());
                  }}
                >
                  <Camera aria-hidden="true" />
                  <strong>{group.name}</strong>
                  <span>{group.number === state.camera.activeGroup && driver.carIdx === state.camera.activeCarIdx ? "Active" : "Take"}</span>
                </button>
              )) : <p>No camera groups available</p>}
            </div>
            <span className={`driver-camera-menu-status is-${state.camera.lastResult ?? state.camera.controller}`} role="status">{cameraStatus}</span>
          </div>
        );
      })()}
    </div>
  );
}
