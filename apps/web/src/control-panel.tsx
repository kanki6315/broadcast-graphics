import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Camera, Flag, KeyRound, LogOut, Radio, Wifi, WifiOff } from "lucide-react";
import { formatLapTime } from "@racecontrol/protocol";
import { useLiveState } from "./use-live-state";

export function TimingDirector({ onManageAccess, onLogout }: { onManageAccess: () => void; onLogout: () => Promise<void> }) {
  const { state, socketConnected, command } = useLiveState("control");
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

  const fastestCarIdx = useMemo(() => {
    const drivers = state?.session?.drivers ?? [];
    return [...drivers]
      .filter((driver) => driver.bestLap != null)
      .sort((a, b) => a.bestLap! - b.bestLap!)[0]?.carIdx;
  }, [state?.session?.drivers]);

  if (!state) {
    return (
      <main className="loading-screen">
        <img className="loading-brand-mark" src="/brand/gantry-mark.svg" alt="" />
        <h1>Connecting to race control</h1>
        <p>Start the server at port 8787, then this desk will recover automatically.</p>
      </main>
    );
  }

  const telemetryHealthy = socketConnected && state.connection === "connected";
  const isSimulated = state.session?.id.toLowerCase().includes("sim") ?? false;
  const cameraGroups = state.camera.groups.filter((group) => !group.isScenic && group.cameras.length > 0);
  const selectedDriver = state.session?.drivers.find((driver) => driver.carIdx === state.graphics.selectedDriverCarIdx);
  const activeDriver = state.session?.drivers.find((driver) => driver.carIdx === state.camera.activeCarIdx);
  const selectedCameraGroup = cameraGroups.find((group) => group.number === state.camera.selectedGroup);
  const activeCameraGroup = state.camera.groups.find((group) => group.number === state.camera.activeGroup);
  const cameraReady = state.camera.controller === "ready" && cameraGroups.length > 0;
  const cameraStatus = state.camera.pendingCommandId
    ? state.camera.lastMessage ?? "Sending camera command"
    : state.camera.lastMessage
      ?? (state.camera.controller === "ready"
        ? "Camera controller ready"
        : state.camera.controller === "unavailable"
          ? "Live iRacing source required"
          : "Telemetry client disconnected");

  function takeDriver(carIdx: number) {
    if (state?.camera.pendingCommandId) return;
    command({ type: "focus.set", carIdx });
  }

  function handleRowKeyDown(carIdx: number, event: ReactKeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    takeDriver(carIdx);
  }

  return (
    <div className="control-shell timing-control-shell">
      <header className="timing-masthead">
        <div className="brand-block">
          <img className="brand-mark" src="/brand/gantry-mark.svg" alt="" />
          <div><strong>Gantry</strong><span>Timing</span></div>
        </div>
        <div className={`connection-plate ${telemetryHealthy ? "is-good" : "is-bad"}`}>
          {telemetryHealthy ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
          <div><strong>{telemetryHealthy ? "Connected" : state.connection}</strong><span>{telemetryHealthy ? "Data feed current" : "Check telemetry client"}</span></div>
        </div>
        <div className="session-plate">
          <strong>{isSimulated ? `Simulated · ${state.session?.name}` : state.session?.name ?? "Waiting for session"}</strong>
          <span>{state.session ? `${state.session.trackName} · Lap ${state.session.lap}${state.session.totalLaps ? ` / ${state.session.totalLaps}` : ""}` : "No telemetry received"}</span>
        </div>
        <div className={`flag-plate flag-${state.session?.flag ?? "green"}`}><Flag aria-hidden="true" /><strong>{state.session?.flag ?? "No flag"}</strong></div>
        <div className="timing-nav">
          <a href="/graphics"><Radio aria-hidden="true" />Graphics</a>
          <button onClick={onManageAccess}><KeyRound aria-hidden="true" />Access</button>
          <button onClick={() => void logout()} disabled={loggingOut}><LogOut aria-hidden="true" />{loggingOut ? "Signing out" : "Sign out"}</button>
          {logoutError && <span className="account-error" role="alert">{logoutError}</span>}
        </div>
      </header>

      <main className="timing-workspace" aria-labelledby="timing-title">
        <div className="timing-heading">
          <div>
            <h1 id="timing-title">Live timing</h1>
            <p>Click a driver to take them on the selected camera group.</p>
          </div>
          <div className="timing-key" aria-label="Timing table key">
            <span><i className="key-selected" />Selected</span>
            <span><i className="key-active" />On camera</span>
            <span><i className="key-fastest" />Fastest lap</span>
          </div>
        </div>

        <div className="timing-table-wrap">
          <table className="timing-table">
            <thead><tr><th>Pos</th><th>No.</th><th>Driver / team</th><th>Gap</th><th>Interval</th><th>Last lap</th><th>Best lap</th><th>Laps</th><th>Status</th></tr></thead>
            <tbody>
              {state.session?.drivers.map((driver) => {
                const selected = driver.carIdx === state.graphics.selectedDriverCarIdx;
                const onCamera = driver.carIdx === state.camera.activeCarIdx;
                const fastest = driver.carIdx === fastestCarIdx;
                const unavailable = Boolean(state.camera.pendingCommandId);
                const status = driver.trackStatus === "pit" ? "Pit"
                  : driver.trackStatus === "off-track" ? "Off track"
                    : driver.trackStatus === "not-in-world" ? "Out"
                      : driver.trackStatus === "retired" ? "Retired"
                        : !driver.isConnected ? "Disconnected"
                          : "Running";
                return (
                  <tr
                    key={driver.carIdx}
                    className={`${selected ? "is-selected" : ""}${onCamera ? " is-on-camera" : ""}${unavailable ? " is-busy" : ""}`}
                    onClick={() => takeDriver(driver.carIdx)}
                    onKeyDown={(event) => handleRowKeyDown(driver.carIdx, event)}
                    tabIndex={0}
                    aria-label={`Take camera on ${driver.name}, position ${driver.position}`}
                    aria-current={onCamera ? "true" : undefined}
                  >
                    <td><span className="position-stamp">{driver.position}</span></td>
                    <td><span className="car-number">{driver.carNumber}</span></td>
                    <td><span className="timing-driver"><strong>{driver.name}</strong><span>{driver.team}</span></span></td>
                    <td className="numeric">{driver.position === 1 ? "Leader" : driver.lapsBehindLeader > 0 ? `+${driver.lapsBehindLeader}L` : driver.gapToLeader == null ? "—" : `+${driver.gapToLeader.toFixed(3)}`}</td>
                    <td className="numeric">{driver.position === 1 ? "—" : driver.intervalToAhead == null ? "—" : `+${driver.intervalToAhead.toFixed(3)}`}</td>
                    <td className="numeric">{formatLapTime(driver.lastLap)}</td>
                    <td className={`numeric ${fastest ? "fastest" : ""}`}>{formatLapTime(driver.bestLap)}</td>
                    <td className="numeric">{driver.lapsCompleted}</td>
                    <td><span className={`status-tag ${driver.trackStatus === "pit" ? "pit" : "running"}`}>{status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!state.session?.drivers.length && <div className="timing-empty">Waiting for timing entries from iRacing.</div>}
        </div>

        <section className={`camera-dock camera-${state.camera.controller}`} aria-label="Camera controls">
          <div className="camera-driver-readout">
            <span>Selected driver</span>
            <strong>{selectedDriver ? `#${selectedDriver.carNumber} ${selectedDriver.name}` : "Select a driver"}</strong>
            <small>{selectedCameraGroup ? `${selectedCameraGroup.name} armed` : "Choose a camera group"}</small>
          </div>
          <div className="camera-group-bank">
            <div className="camera-bank-heading">
              <span><Camera aria-hidden="true" />Camera groups</span>
              <span className={`camera-status is-${state.camera.lastResult ?? state.camera.controller}`} role="status">{cameraStatus}</span>
            </div>
            {cameraGroups.length > 0 ? (
              <div className="camera-group-grid" role="group" aria-label="Take selected driver on camera group" aria-busy={Boolean(state.camera.pendingCommandId)}>
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
                      aria-label={`Take ${selectedDriver?.name ?? "selected driver"} on ${group.name}`}
                      aria-pressed={isSelected}
                    >
                      <strong>{group.name}</strong>
                      <span>{isActive ? "Active" : isSelected ? "Selected" : "Take"}</span>
                    </button>
                  );
                })}
              </div>
            ) : <p className="camera-empty">No camera groups available.</p>}
          </div>
          <div className="camera-live-readout">
            <span>Observed camera</span>
            <strong>{activeDriver ? `#${activeDriver.carNumber} ${activeDriver.name}` : "No live driver"}</strong>
            <small>{activeCameraGroup?.name ?? "No active group"}</small>
          </div>
        </section>
      </main>
    </div>
  );
}
