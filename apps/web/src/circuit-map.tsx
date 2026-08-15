import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { DriverState, SectorBoundary, TrackMapCalibration, TrackMapDefinition } from "@racecontrol/protocol";
import { pointForLapPct } from "./track-map-geometry";
import "./circuit-map.css";

export interface CircuitMapProps {
  definition: TrackMapDefinition;
  calibration: TrackMapCalibration;
  drivers: DriverState[];
  sectorBoundaries?: SectorBoundary[];
  fallback?: ReactNode;
}

interface DisplayPoint { x: number; y: number }

interface ProjectedCar {
  driver: DriverState;
  displayPoint: DisplayPoint;
  classLeader: boolean;
  uncertain: boolean;
}

interface LabelLayout {
  cars: ProjectedCar[];
  offsets: Map<number, DisplayPoint>;
}

function rotatePoint(point: DisplayPoint, center: DisplayPoint, degrees: number): DisplayPoint {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const offsetX = point.x - center.x;
  const offsetY = point.y - center.y;
  return {
    x: center.x + offsetX * cosine - offsetY * sine,
    y: center.y + offsetX * sine + offsetY * cosine,
  };
}

function projectPoint(point: DisplayPoint, viewBox: [number, number, number, number], stage: DisplayPoint, rotationDegrees: number): DisplayPoint {
  const [viewX, viewY, viewWidth, viewHeight] = viewBox;
  const padding = 10;
  const innerWidth = Math.max(0, stage.x - padding * 2);
  const innerHeight = Math.max(0, stage.y - padding * 2);
  const scale = Math.min(innerWidth / viewWidth, innerHeight / viewHeight);
  const renderedWidth = viewWidth * scale;
  const renderedHeight = viewHeight * scale;
  const offsetX = padding + (innerWidth - renderedWidth) / 2;
  const offsetY = padding + (innerHeight - renderedHeight) / 2;
  const rotated = rotatePoint(point, { x: viewX + viewWidth / 2, y: viewY + viewHeight / 2 }, rotationDegrees);
  return { x: offsetX + (rotated.x - viewX) * scale, y: offsetY + (rotated.y - viewY) * scale };
}

function spreadLabels(cars: ProjectedCar[], stage: DisplayPoint, previousOffsets: ReadonlyMap<number, DisplayPoint>, minimumX = 41, minimumY = 27): LabelLayout {
  const placed: ProjectedCar[] = [];
  const nextOffsets = new Map<number, DisplayPoint>();
  const step = minimumY + 1;
  const offsets = [0, -step, step, -step * 2, step * 2, -step * 3, step * 3];
  for (const car of cars) {
    let candidate = car.displayPoint;
    let selectedOffset = { x: 0, y: 0 };
    const previousOffset = previousOffsets.get(car.driver.carIdx);
    if (previousOffset) {
      candidate = {
        x: Math.max(24, Math.min(stage.x - 24, car.displayPoint.x + previousOffset.x)),
        y: Math.max(17, Math.min(stage.y - 17, car.displayPoint.y + previousOffset.y)),
      };
      placed.push({ ...car, displayPoint: candidate });
      nextOffsets.set(car.driver.carIdx, previousOffset);
      continue;
    }
    const candidates = offsets.flatMap((yOffset) => [0, -22, 22].map((xOffset) => ({ x: xOffset, y: yOffset })));
    outer: for (const { x: xOffset, y: yOffset } of candidates) {
      const next = {
        x: Math.max(24, Math.min(stage.x - 24, car.displayPoint.x + xOffset)),
        y: Math.max(17, Math.min(stage.y - 17, car.displayPoint.y + yOffset)),
      };
      if (placed.every((item) => Math.abs(item.displayPoint.x - next.x) >= minimumX || Math.abs(item.displayPoint.y - next.y) >= minimumY)) {
        candidate = next;
        selectedOffset = { x: xOffset, y: yOffset };
        break outer;
      }
    }
    placed.push({ ...car, displayPoint: candidate });
    nextOffsets.set(car.driver.carIdx, selectedOffset);
  }
  return { cars: placed, offsets: nextOffsets };
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

export function CircuitMap({ definition, calibration, drivers, sectorBoundaries = [], fallback }: CircuitMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const labelOffsetsRef = useRef<Map<number, DisplayPoint>>(new Map());
  const [pathReady, setPathReady] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState<DisplayPoint>({ x: 0, y: 0 });
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

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setStageSize({ x: stage.clientWidth, y: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

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

  const projectedCars = useMemo<ProjectedCar[]>(() => positioned.points.map(({ driver, point }) => ({
    driver,
    displayPoint: projectPoint(point, definition.viewBox, stageSize, calibration.rotationDegrees ?? 0),
    classLeader: driver.classPosition === 1,
    uncertain: driver.timingQuality?.lapDistPct?.quality === "inferred",
  })), [calibration.rotationDegrees, definition.viewBox, positioned.points, stageSize]);

  const labelLayout = useMemo(() => spreadLabels(projectedCars, stageSize, labelOffsetsRef.current), [projectedCars, stageSize]);
  useLayoutEffect(() => {
    labelOffsetsRef.current = labelLayout.offsets;
  }, [labelLayout.offsets]);

  if (renderError || positioned.error) return <><div className="circuit-map-error" role="alert"><strong>Circuit map unavailable</strong><span>{renderError ?? positioned.error} Linear track remains active.</span></div>{fallback}</>;

  const centerX = definition.viewBox[0] + definition.viewBox[2] / 2;
  const centerY = definition.viewBox[1] + definition.viewBox[3] / 2;
  return (
    <section className="circuit-map" aria-label="Calibrated circuit position map">
      <header>
        <div><strong>Circuit map</strong><span>CAL {calibration.revision} · {calibration.direction} · {definition.source}</span></div>
        <div className="circuit-map-legend" aria-label="Map key"><span><b>L</b>Class leader</span><span><i className="legend-inferred">~</i>Inferred position</span></div>
      </header>
      <div className="circuit-map-stage" ref={stageRef}>
        <svg viewBox={definition.viewBox.join(" ")} role="img" aria-label={`${definition.layout.trackName} calibrated centerline`}>
          <g transform={`rotate(${calibration.rotationDegrees ?? 0} ${centerX} ${centerY})`}>
            <path className="circuit-map-bed" d={definition.centerlinePath} />
            <path ref={pathRef} className="circuit-map-centerline" d={definition.centerlinePath} />
            {markerPoints.map(({ boundary, point }) => <g className={`sector-map-marker${boundary.sectorNumber === 1 ? " is-start" : ""}`} key={boundary.sectorNumber} transform={`translate(${point.x} ${point.y})`}><circle r="3" /><text y="-6">{boundary.sectorNumber === 1 ? "S/F" : `S${boundary.sectorNumber}`}</text></g>)}
            {positioned.points.map(({ driver, point }) => {
              const uncertain = driver.timingQuality?.lapDistPct?.quality === "inferred";
              return <g key={driver.carIdx} className={`circuit-car-anchor${uncertain ? " is-uncertain" : ""}`} style={{ transform: `translate(${point.x}px, ${point.y}px)`, "--class-color": driver.classColor } as CSSProperties}><circle r="3" /></g>;
            })}
          </g>
        </svg>
        <div className="circuit-map-label-layer" aria-label="Cars circulating on the circuit">
          {labelLayout.cars.map((car) => (
            <span
              key={car.driver.carIdx}
              title={`#${car.driver.carNumber} ${car.driver.name} · ${car.driver.className} P${car.driver.classPosition}${car.uncertain ? " · position inferred" : ""}`}
              className={`circuit-car-label${car.classLeader ? " is-class-leader" : ""}${car.uncertain ? " is-uncertain" : ""}`}
              style={{ left: car.displayPoint.x, top: car.displayPoint.y, "--class-color": car.driver.classColor } as CSSProperties}
            >
              <span>#{car.driver.carNumber}</span>
              {car.classLeader && <b>L</b>}
            </span>
          ))}
        </div>
      </div>
      <aside className="circuit-map-dock" aria-label="Cars not placed on the racing centerline">
        <div><strong>Pit dock</strong><span>{groups.pit.length}</span></div>
        <div className="map-dock-cars">{groups.pit.length ? groups.pit.map((driver) => <span className="map-dock-car" key={driver.carIdx} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}<small>{driver.pitState === "pit-stall" ? "STALL" : "LANE"}</small></span>) : <span>Clear</span>}</div>
        <div><strong>Unavailable</strong><span>{groups.unknown.length}</span></div>
        <div className="map-dock-cars">{groups.unknown.length ? groups.unknown.map((driver) => <span className="map-dock-car" key={driver.carIdx} style={{ "--class-color": driver.classColor } as CSSProperties}>#{driver.carNumber}<small>{driver.trackStatus === "retired" ? "OUT" : "NO POS"}</small></span>) : <span>None</span>}</div>
      </aside>
    </section>
  );
}
