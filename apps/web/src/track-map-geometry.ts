import type { TrackMapCalibration } from "@racecontrol/protocol";

export interface MapPoint { x: number; y: number }
export interface PathLengthReader {
  getTotalLength(): number;
  getPointAtLength(distance: number): MapPoint;
}

export function wrapPct(value: number): number { return ((value % 1) + 1) % 1; }

export function lapPctToPathPct(lapPct: number, calibration: Pick<TrackMapCalibration, "startFinishPathPct" | "direction">): number {
  return wrapPct(calibration.startFinishPathPct + (calibration.direction === "forward" ? lapPct : -lapPct));
}

export function pathPctToLapPct(pathPct: number, calibration: Pick<TrackMapCalibration, "startFinishPathPct" | "direction">): number {
  return wrapPct(calibration.direction === "forward"
    ? pathPct - calibration.startFinishPathPct
    : calibration.startFinishPathPct - pathPct);
}

export function pointForLapPct(path: PathLengthReader, lapPct: number, calibration: Pick<TrackMapCalibration, "startFinishPathPct" | "direction">): MapPoint {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) throw new Error("The centerline could not be measured.");
  return path.getPointAtLength(lapPctToPathPct(lapPct, calibration) * length);
}

export function pointAndHeadingForLapPct(path: PathLengthReader, lapPct: number, calibration: Pick<TrackMapCalibration, "startFinishPathPct" | "direction">): MapPoint & { angleDegrees: number } {
  const point = pointForLapPct(path, lapPct, calibration);
  const before = pointForLapPct(path, wrapPct(lapPct - 0.0025), calibration);
  const after = pointForLapPct(path, wrapPct(lapPct + 0.0025), calibration);
  return { ...point, angleDegrees: Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI };
}

/** Bounded nearest-point projection in SVG view-box coordinates. */
export function projectToPath(path: PathLengthReader, target: MapPoint, calibration: Pick<TrackMapCalibration, "startFinishPathPct" | "direction">): { point: MapPoint; pathPct: number; lapPct: number } {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error("The point cannot be projected onto this centerline.");
  const distanceSquared = (point: MapPoint) => (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
  const samples = 512;
  let bestDistance = 0;
  let bestScore = Infinity;
  for (let index = 0; index <= samples; index++) {
    const at = length * index / samples;
    const score = distanceSquared(path.getPointAtLength(at));
    if (score < bestScore) { bestScore = score; bestDistance = at; }
  }
  let step = length / samples;
  for (let iteration = 0; iteration < 12; iteration++) {
    const before = Math.max(0, bestDistance - step);
    const after = Math.min(length, bestDistance + step);
    const beforeScore = distanceSquared(path.getPointAtLength(before));
    const afterScore = distanceSquared(path.getPointAtLength(after));
    if (beforeScore < bestScore) { bestScore = beforeScore; bestDistance = before; }
    if (afterScore < bestScore) { bestScore = afterScore; bestDistance = after; }
    step /= 2;
  }
  const pathPct = wrapPct(bestDistance / length);
  return { point: path.getPointAtLength(bestDistance), pathPct, lapPct: pathPctToLapPct(pathPct, calibration) };
}

export function clientPointToViewBox(svg: SVGSVGElement, clientX: number, clientY: number): MapPoint {
  const matrix = svg.getScreenCTM();
  if (!matrix) throw new Error("The map transform is unavailable.");
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}
