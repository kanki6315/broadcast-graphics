import { formatLapTime, type DriverState } from "@racecontrol/protocol";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface TimingTableProps {
  drivers: DriverState[];
  selectedCarIdx: number | null;
  activeCameraCarIdx?: number | null;
  fastestCarIdx?: number;
  selectionPending?: boolean;
  onSelectCar: (carIdx: number) => void;
  selectionLabel?: (driver: DriverState) => string;
}

function driverStatus(driver: DriverState): string {
  if (driver.pitState === "pit-stall") return "In box";
  if (driver.pitState === "pit-lane") return "Pit lane";
  if (driver.pitState === "unobserved") return "Unobserved";
  if (driver.trackStatus === "pit") return "Pit";
  if (driver.trackStatus === "off-track") return "Off track";
  if (driver.trackStatus === "not-in-world") return "Out";
  if (driver.trackStatus === "retired") return "Retired";
  if (!driver.isConnected) return "Disconnected";
  return "Running";
}

export function TimingTable({
  drivers,
  selectedCarIdx,
  activeCameraCarIdx,
  fastestCarIdx,
  selectionPending = false,
  onSelectCar,
  selectionLabel = (driver) => `Select ${driver.name}, position ${driver.position}`,
}: TimingTableProps) {
  function handleRowKeyDown(carIdx: number, event: ReactKeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectCar(carIdx);
  }

  return (
    <div className="timing-table-wrap">
      <table className="timing-table">
        <thead><tr><th>Pos</th><th>No.</th><th>Driver / team</th><th>Gap</th><th>Interval</th><th>Last lap</th><th>Best lap</th><th>Laps</th><th>Status</th></tr></thead>
        <tbody>
          {drivers.map((driver) => {
            const selected = driver.carIdx === selectedCarIdx;
            const onCamera = driver.carIdx === activeCameraCarIdx;
            const fastest = driver.carIdx === fastestCarIdx;
            const status = driverStatus(driver);
            const inPits = driver.pitState === "pit-lane" || driver.pitState === "pit-stall" || driver.trackStatus === "pit";
            return (
              <tr
                key={driver.carIdx}
                className={`${selected ? "is-selected" : ""}${onCamera ? " is-on-camera" : ""}${selectionPending ? " is-busy" : ""}`}
                onClick={() => onSelectCar(driver.carIdx)}
                onKeyDown={(event) => handleRowKeyDown(driver.carIdx, event)}
                tabIndex={0}
                aria-label={selectionLabel(driver)}
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
                <td><span className={`status-tag ${inPits ? "pit" : "running"}`}>{status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {drivers.length === 0 && <div className="timing-empty">Waiting for timing entries from iRacing.</div>}
    </div>
  );
}
