import { useMemo, useState } from "react";
import { Camera, Flag, KeyRound, LogOut, MapPinned, Radio, Wifi, WifiOff } from "lucide-react";
import { LinearTrackRibbon } from "./linear-track-ribbon";
import { TimingTable } from "./timing-table";
import { useLiveState } from "./use-live-state";

export function TimingDirector({ onManageAccess, onTrackConfig, onLogout }: { onManageAccess: () => void; onTrackConfig: () => void; onLogout: () => Promise<void> }) {
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
          <a href="/timing">Commentator</a>
          <a href="/graphics"><Radio aria-hidden="true" />Graphics</a>
          <button onClick={onTrackConfig}><MapPinned aria-hidden="true" />Track config</button>
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

        <LinearTrackRibbon
          drivers={state.session?.drivers ?? []}
          selectedCarIdx={state.graphics.selectedDriverCarIdx}
          onSelectCar={takeDriver}
        />

        <TimingTable
          drivers={state.session?.drivers ?? []}
          selectedCarIdx={state.graphics.selectedDriverCarIdx}
          activeCameraCarIdx={state.camera.activeCarIdx}
          fastestCarIdx={fastestCarIdx}
          selectionPending={Boolean(state.camera.pendingCommandId)}
          onSelectCar={takeDriver}
          selectionLabel={(driver) => `Take camera on ${driver.name}, position ${driver.position}`}
        />

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
