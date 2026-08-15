import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { DriverState, SectorBoundary, TrackMapCalibration, TrackMapDefinition } from "@racecontrol/protocol";
import { pointForLapPct } from "./track-map-geometry";
import "./circuit-map.css";

export interface CircuitMapProps {
  definition: TrackMapDefinition;
  calibration: TrackMapCalibration;
  drivers: DriverState[];
  selectedCarIdx?: number | null;
  nearbyCarIdxs?: ReadonlySet<number>;
  sectorBoundaries?: SectorBoundary[];
  onSelectCar?: (carIdx: number) => void;
  readOnly?: boolean;
  fallback?: ReactNode;
}

function isPit(driver: DriverState): boolean {
  return driver.pitState === "pit-lane" || driver.pitState === "pit-stall" || (driver.pitState == null && driver.trackStatus === "pit");
}

function unavailable(driver: DriverState): boolean {
  const quality = driver.timingQuality?.lapDistPct;
  return !driver.isConnected || driver.pitState === "unobserved" || driver.trackStatus === "not-in-world" || driver.trackStatus === "retired"
    || driver.lapDistPct == null || !Number.isFinite(driver.lapDistPct) || driver.lapDistPct < 0 || driver.lapDistPct >= 1
    || quality?.quality === "invalid" || quality?.quality === "incomplete";
}

export function CircuitMap({ definition, calibration, drivers, selectedCarIdx = null, nearbyCarIdxs = new Set(), sectorBoundaries = [], onSelectCar, readOnly = true, fallback }: CircuitMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathReady, setPathReady] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  useLayoutEffect(() => {
    try {
      const length = pathRef.current?.getTotalLength() ?? 0;
      if (!Number.isFinite(length) || length <= 0) throw new Error("The calibrated centerline has no measurable length.");
      setRenderError(null);
      setPathReady((value) => value + 1);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "The circuit map could not be rendered.");
    }
  }, [definition.id, definition.centerlinePath]);

  const groups = useMemo(() => {
    const pit = drivers.filter((driver) => isPit(driver) && !unavailable(driver));
    const unknown = drivers.filter((driver) => !isPit(driver) && unavailable(driver));
    const circulating = drivers.filter((driver) => !isPit(driver) && !unavailable(driver));
    return { pit, unknown, circulating };
  }, [drivers]);

  const positioned = useMemo(() => {
    if (!pathReady || !pathRef.current) return { points: [], error: null as string | null };
    try {
      return { points: groups.circulating.map((driver) => ({ driver, point: pointForLapPct(pathRef.current!, driver.lapDistPct!, calibration) })), error: null };
    } catch (error) {
      return { points: [], error: error instanceof Error ? error.message : "Car positions could not be resolved." };
    }
  }, [calibration, groups.circulating, pathReady]);

  const markerPoints = useMemo(() => {
    if (!pathReady || !pathRef.current) return [];
    return sectorBoundaries.map((boundary) => ({ boundary, point: pointForLapPct(pathRef.current!, boundary.startPct, calibration) }));
  }, [calibration, pathReady, sectorBoundaries]);

  if (renderError || positioned.error) return <><div className="circuit-map-error" role="alert"><strong>Circuit map unavailable</strong><span>{renderError ?? positioned.error} Linear track remains active.</span></div>{fallback}</>;

  const centerX = definition.viewBox[0] + definition.viewBox[2] / 2;
  const centerY = definition.viewBox[1] + definition.viewBox[3] / 2;
  const handleKey = (event: KeyboardEvent<SVGGElement>, carIdx: number) => {
    if (onSelectCar && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectCar(carIdx); }
  };

  return (
    <section className="circuit-map" aria-label="Calibrated circuit position map" data-read-only={readOnly}>
      <header>
        <div><strong>Circuit map</strong><span>CAL {calibration.revision} · {calibration.direction} · {definition.source}</span></div>
        <div className="circuit-map-legend" aria-label="Map key">{onSelectCar && <><span><i className="legend-selected" />Selected</span><span><i className="legend-nearby" />Same-class proximity</span></>}<span><b>L</b>Class leader</span></div>
      </header>
      <div className="circuit-map-stage">
        <svg viewBox={definition.viewBox.join(" ")} role="img" aria-label={`${definition.layout.trackName} calibrated centerline`}>
          <g transform={`rotate(${calibration.rotationDegrees ?? 0} ${centerX} ${centerY})`}>
            <path className="circuit-map-bed" d={definition.centerlinePath} />
            <path ref={pathRef} className="circuit-map-centerline" d={definition.centerlinePath} />
            {markerPoints.map(({ boundary, point }) => <g className={`sector-map-marker${boundary.sectorNumber === 1 ? " is-start" : ""}`} key={boundary.sectorNumber} transform={`translate(${point.x} ${point.y})`}><circle r="3" /><text y="-6">{boundary.sectorNumber === 1 ? "S/F" : `S${boundary.sectorNumber}`}</text></g>)}
            {positioned.points.map(({ driver, point }) => {
              const selected = driver.carIdx === selectedCarIdx;
              const nearby = nearbyCarIdxs.has(driver.carIdx);
              const classLeader = driver.classPosition === 1;
              const uncertain = driver.timingQuality?.lapDistPct?.quality === "inferred";
              return <g
                key={driver.carIdx}
                role={onSelectCar ? "button" : undefined}
                tabIndex={onSelectCar ? 0 : undefined}
                aria-label={`Car ${driver.carNumber}, ${driver.name}, ${driver.className} position ${driver.classPosition}${uncertain ? ", position inferred" : ""}`}
                className={`circuit-car${selected ? " is-selected" : ""}${nearby ? " is-nearby" : ""}${classLeader ? " is-class-leader" : ""}${uncertain ? " is-uncertain" : ""}`}
                style={{ transform: `translate(${point.x}px, ${point.y}px)`, "--class-color": driver.classColor } as CSSProperties}
                onClick={onSelectCar ? () => onSelectCar(driver.carIdx) : undefined}
                onKeyDown={onSelectCar ? (event) => handleKey(event, driver.carIdx) : undefined}
              >
                <title>#{driver.carNumber} {driver.name} · {driver.className} P{driver.classPosition}</title>
                <circle r={selected ? 8.5 : 6.5} />
                <text textAnchor="middle" dominantBaseline="central">{driver.carNumber}</text>
                {classLeader && <text className="leader-mark" x="8" y="-7">L</text>}
              </g>;
            })}
          </g>
        </svg>
      </div>
      <aside className="circuit-map-dock" aria-label="Cars not placed on the racing centerline">
        <div><strong>Pit dock</strong><span>{groups.pit.length}</span></div>
        <div className="map-dock-cars">{groups.pit.length ? groups.pit.map((driver) => onSelectCar ? <button key={driver.carIdx} type="button" onClick={() => onSelectCar(driver.carIdx)} className={driver.carIdx === selectedCarIdx ? "is-selected" : ""} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}<small>{driver.pitState === "pit-stall" ? "STALL" : "LANE"}</small></button> : <span className="map-dock-car" key={driver.carIdx} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}<small>{driver.pitState === "pit-stall" ? "STALL" : "LANE"}</small></span>) : <span>Clear</span>}</div>
        <div><strong>Unavailable</strong><span>{groups.unknown.length}</span></div>
        <div className="map-dock-cars">{groups.unknown.length ? groups.unknown.map((driver) => onSelectCar ? <button key={driver.carIdx} type="button" onClick={() => onSelectCar(driver.carIdx)} className={driver.carIdx === selectedCarIdx ? "is-selected" : ""} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}<small>{driver.trackStatus === "retired" ? "OUT" : "NO POS"}</small></button> : <span className="map-dock-car" key={driver.carIdx} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}<small>{driver.trackStatus === "retired" ? "OUT" : "NO POS"}</small></span>) : <span>None</span>}</div>
      </aside>
    </section>
  );
}
