import type { DriverState } from "@racecontrol/protocol";
import type { CSSProperties } from "react";
import "./linear-track-ribbon.css";

export interface LinearTrackRibbonProps {
  drivers: DriverState[];
  selectedCarIdx?: number | null;
  nearbyCarIdxs?: ReadonlySet<number>;
  onSelectCar?: (carIdx: number) => void;
  variant?: "control" | "commentator";
}

/**
 * Presentation boundary for the Increment 1 track ribbon. Its implementation is
 * intentionally isolated so ribbon work can proceed without changing the timing table.
 */
export function LinearTrackRibbon({ drivers, selectedCarIdx = null, nearbyCarIdxs = new Set(), onSelectCar, variant = "control" }: LinearTrackRibbonProps) {
  const unobserved = drivers.filter((driver) => driver.pitState === "unobserved" || driver.trackStatus === "not-in-world" || !driver.isConnected);
  const circulating = drivers.filter((driver) =>
    driver.lapDistPct != null
    && !unobserved.includes(driver)
    && (driver.pitState === "not-in-pits" || (driver.pitState == null && driver.trackStatus !== "pit")),
  );
  const inPits = drivers.filter((driver) =>
    !unobserved.includes(driver)
    && (driver.pitState === "pit-lane" || driver.pitState === "pit-stall" || (driver.pitState == null && driver.trackStatus === "pit")),
  );
  const classes = [...new Map(drivers.map((driver) => [driver.classId, { id: driver.classId, name: driver.className, color: driver.classColor }])).values()];

  return (
    <section className={`track-ribbon variant-${variant}`} aria-label="Linear track position">
      {variant === "commentator" && <header className="track-ribbon-header"><strong>Linear track</strong><div>{classes.map((carClass) => <span key={carClass.id} style={{ "--class-color": carClass.color } as CSSProperties}><i />{carClass.name}</span>)}</div></header>}
      <div className="track-ribbon-lane">
        <span className="track-ribbon-label">Track</span>
        <div className="track-ribbon-line">
          {circulating.map((driver) => onSelectCar ? (
            <button
              key={driver.carIdx}
              type="button"
              className={`${driver.carIdx === selectedCarIdx ? "is-selected" : ""}${nearbyCarIdxs.has(driver.carIdx) ? " is-nearby" : ""}`}
              style={{ left: `${Math.max(0, Math.min(1, driver.lapDistPct ?? 0)) * 100}%`, "--class-color": driver.classColor } as CSSProperties}
              onClick={() => onSelectCar(driver.carIdx)}
              aria-label={`Select car ${driver.carNumber}, ${driver.name}`}
              title={`#${driver.carNumber} ${driver.name}`}
            >
              {driver.carNumber}
            </button>
          ) : <span key={driver.carIdx} className="track-ribbon-car" style={{ left: `${Math.max(0, Math.min(1, driver.lapDistPct ?? 0)) * 100}%`, "--class-color": driver.classColor } as CSSProperties} title={`#${driver.carNumber} ${driver.name}`}>{driver.carNumber}</span>)}
        </div>
      </div>
      <div className="track-ribbon-pits">
        <span className="track-ribbon-label">Pit</span>
        <div>{inPits.map((driver) => onSelectCar ? <button className={`${driver.carIdx === selectedCarIdx ? "is-selected" : ""}${nearbyCarIdxs.has(driver.carIdx) ? " is-nearby" : ""}`} key={driver.carIdx} type="button" onClick={() => onSelectCar(driver.carIdx)} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}</button> : <span className="track-ribbon-car" key={driver.carIdx} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}</span>)}</div>
      </div>
      {unobserved.length > 0 && <div className="track-ribbon-unobserved"><span className="track-ribbon-label">Unknown</span><div>{unobserved.map((driver) => onSelectCar ? <button className={driver.carIdx === selectedCarIdx ? "is-selected" : ""} key={driver.carIdx} type="button" onClick={() => onSelectCar(driver.carIdx)} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}</button> : <span className="track-ribbon-car" key={driver.carIdx} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}</span>)}</div></div>}
    </section>
  );
}
