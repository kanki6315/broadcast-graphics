import type { DriverState } from "@racecontrol/protocol";
import type { CSSProperties } from "react";
import "./linear-track-ribbon.css";

export interface LinearTrackRibbonProps {
  drivers: DriverState[];
  selectedCarIdx: number | null;
  onSelectCar: (carIdx: number) => void;
}

/**
 * Presentation boundary for the Increment 1 track ribbon. Its implementation is
 * intentionally isolated so ribbon work can proceed without changing the timing table.
 */
export function LinearTrackRibbon({ drivers, selectedCarIdx, onSelectCar }: LinearTrackRibbonProps) {
  const circulating = drivers.filter((driver) => driver.lapDistPct != null && driver.pitState !== "pit-lane" && driver.pitState !== "pit-stall" && driver.trackStatus !== "pit");
  const inPits = drivers.filter((driver) => driver.pitState === "pit-lane" || driver.pitState === "pit-stall" || driver.trackStatus === "pit");

  return (
    <section className="track-ribbon" aria-label="Linear track position">
      <div className="track-ribbon-lane">
        <span className="track-ribbon-label">Track</span>
        <div className="track-ribbon-line">
          {circulating.map((driver) => (
            <button
              key={driver.carIdx}
              type="button"
              className={driver.carIdx === selectedCarIdx ? "is-selected" : ""}
              style={{ left: `${Math.max(0, Math.min(1, driver.lapDistPct ?? 0)) * 100}%`, "--class-color": driver.classColor } as CSSProperties}
              onClick={() => onSelectCar(driver.carIdx)}
              aria-label={`Select car ${driver.carNumber}, ${driver.name}`}
              title={`#${driver.carNumber} ${driver.name}`}
            >
              {driver.carNumber}
            </button>
          ))}
        </div>
      </div>
      <div className="track-ribbon-pits">
        <span className="track-ribbon-label">Pit</span>
        <div>{inPits.map((driver) => <button key={driver.carIdx} type="button" onClick={() => onSelectCar(driver.carIdx)} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}</button>)}</div>
      </div>
    </section>
  );
}
