import { createHash } from "node:crypto";
import type { TrackMapPathCandidate } from "@racecontrol/protocol";

export const SVG_LIMITS = {
  bytes: 1_000_000,
  elements: 2_000,
  paths: 250,
  pathCommands: 20_000,
  coordinate: 1_000_000,
  samplesPerCurve: 12,
} as const;

export interface Point { x: number; y: number }
export interface PreparedPath {
  points: Point[];
  cumulativeLengths: number[];
  length: number;
  closed: boolean;
}

export interface SanitizedTrackSvg {
  checksum: string;
  sanitizedSvg: string;
  viewBox: [number, number, number, number];
  candidates: TrackMapPathCandidate[];
}

export class TrackMapValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

const numberPattern = "[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?";
const pathToken = new RegExp(`([AaCcHhLlMmQqSsTtVvZz])|(${numberPattern})`, "g");

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new TrackMapValidationError("The centerline contains a non-finite coordinate.", "non-finite-coordinate");
  if (Math.abs(value) > SVG_LIMITS.coordinate) throw new TrackMapValidationError("The centerline exceeds the coordinate limit.", "coordinate-bounds");
  return value;
}

function tokenizePath(pathData: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  let lastIndex = 0;
  for (const match of pathData.matchAll(pathToken)) {
    const skipped = pathData.slice(lastIndex, match.index).replace(/[\s,]+/g, "");
    if (skipped) throw new TrackMapValidationError("The selected path contains unsupported syntax.", "invalid-path");
    tokens.push(match[1] ?? finite(Number(match[2])));
    lastIndex = (match.index ?? 0) + match[0].length;
    if (tokens.length > SVG_LIMITS.pathCommands * 8) throw new TrackMapValidationError("The selected path is too complex.", "path-complexity");
  }
  if (pathData.slice(lastIndex).replace(/[\s,]+/g, "")) throw new TrackMapValidationError("The selected path contains unsupported syntax.", "invalid-path");
  return tokens;
}

function distance(a: Point, b: Point): number { return Math.hypot(b.x - a.x, b.y - a.y); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}
function quadratic(a: number, b: number, c: number, t: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

function arcPoints(from: Point, rxInput: number, ryInput: number, rotation: number, largeArc: number, sweep: number, to: Point): Point[] {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx === 0 || ry === 0 || distance(from, to) < 1e-9) return [to];
  const phi = rotation * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;
  const scale = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (scale > 1) { const factor = Math.sqrt(scale); rx *= factor; ry *= factor; }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1);
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cx1 = coefficient * (rx * y1 / ry);
  const cy1 = coefficient * (-ry * x1 / rx);
  const cx = cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1 - cx1) / rx;
  const uy = (y1 - cy1) / ry;
  const vx = (-x1 - cx1) / rx;
  const vy = (-y1 - cy1) / ry;
  const start = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const count = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 12)));
  return Array.from({ length: count }, (_, index) => {
    const theta = start + delta * ((index + 1) / count);
    return {
      x: finite(cx + cosPhi * rx * Math.cos(theta) - sinPhi * ry * Math.sin(theta)),
      y: finite(cy + sinPhi * rx * Math.cos(theta) + cosPhi * ry * Math.sin(theta)),
    };
  });
}

export function prepareSvgPath(pathData: string, requireClosed = true): PreparedPath {
  const tokens = tokenizePath(pathData);
  const points: Point[] = [];
  let index = 0;
  let command = "";
  let current: Point = { x: 0, y: 0 };
  let start: Point = current;
  let cubicControl: Point | null = null;
  let quadraticControl: Point | null = null;
  let commandCount = 0;
  const push = (point: Point) => { current = { x: finite(point.x), y: finite(point.y) }; points.push(current); };
  const read = () => {
    const value = tokens[index++];
    if (typeof value !== "number") throw new TrackMapValidationError("The selected path has missing coordinates.", "invalid-path");
    return value;
  };
  const hasNumbers = () => typeof tokens[index] === "number";
  while (index < tokens.length) {
    if (typeof tokens[index] === "string") command = tokens[index++] as string;
    if (!command) throw new TrackMapValidationError("The selected path must begin with a move command.", "invalid-path");
    if (++commandCount > SVG_LIMITS.pathCommands) throw new TrackMapValidationError("The selected path is too complex.", "path-complexity");
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const point = (x: number, y: number): Point => relative ? { x: current.x + x, y: current.y + y } : { x, y };
    if (upper === "Z") {
      if (distance(current, start) > 1e-9) push(start);
      cubicControl = quadraticControl = null;
      command = "";
      continue;
    }
    if (!hasNumbers()) throw new TrackMapValidationError("The selected path has a command without coordinates.", "invalid-path");
    if (upper === "M") {
      const next = point(read(), read());
      push(next); start = next; cubicControl = quadraticControl = null;
      command = relative ? "l" : "L";
      continue;
    }
    if (upper === "L") { push(point(read(), read())); cubicControl = quadraticControl = null; continue; }
    if (upper === "H") { push({ x: relative ? current.x + read() : read(), y: current.y }); cubicControl = quadraticControl = null; continue; }
    if (upper === "V") { push({ x: current.x, y: relative ? current.y + read() : read() }); cubicControl = quadraticControl = null; continue; }
    if (upper === "C" || upper === "S") {
      const from = current;
      const c1 = upper === "C" ? point(read(), read()) : (cubicControl ? { x: 2 * from.x - cubicControl.x, y: 2 * from.y - cubicControl.y } : from);
      const c2 = point(read(), read());
      const to = point(read(), read());
      for (let step = 1; step <= SVG_LIMITS.samplesPerCurve; step++) {
        const t = step / SVG_LIMITS.samplesPerCurve;
        push({ x: cubic(from.x, c1.x, c2.x, to.x, t), y: cubic(from.y, c1.y, c2.y, to.y, t) });
      }
      cubicControl = c2; quadraticControl = null; continue;
    }
    if (upper === "Q" || upper === "T") {
      const from = current;
      const control: Point = upper === "Q" ? point(read(), read()) : (quadraticControl ? { x: 2 * from.x - quadraticControl.x, y: 2 * from.y - quadraticControl.y } : from);
      const to = point(read(), read());
      for (let step = 1; step <= SVG_LIMITS.samplesPerCurve; step++) {
        const t = step / SVG_LIMITS.samplesPerCurve;
        push({ x: quadratic(from.x, control.x, to.x, t), y: quadratic(from.y, control.y, to.y, t) });
      }
      quadraticControl = control; cubicControl = null; continue;
    }
    if (upper === "A") {
      const rx = read(), ry = read(), rotation = read(), largeArc = read(), sweep = read();
      if (![0, 1].includes(largeArc) || ![0, 1].includes(sweep)) throw new TrackMapValidationError("Arc flags must be zero or one.", "invalid-path");
      const to = point(read(), read());
      for (const sample of arcPoints(current, rx, ry, rotation, largeArc, sweep, to)) push(sample);
      cubicControl = quadraticControl = null; continue;
    }
    throw new TrackMapValidationError(`Path command ${command} is not supported.`, "invalid-path");
  }
  if (points.length < 2) throw new TrackMapValidationError("The selected path has zero or insufficient length.", "zero-length-path");
  const cumulativeLengths = [0];
  for (let i = 1; i < points.length; i++) cumulativeLengths.push(cumulativeLengths[i - 1]! + distance(points[i - 1]!, points[i]!));
  const length = cumulativeLengths.at(-1) ?? 0;
  if (!Number.isFinite(length) || length <= 1e-6) throw new TrackMapValidationError("The selected path has zero or non-finite length.", "zero-length-path");
  const endpointGap = distance(points[0]!, points.at(-1)!);
  const closed = endpointGap <= Math.max(1, length * 0.01);
  if (requireClosed && !closed) throw new TrackMapValidationError("The selected centerline is open; its endpoints must be within 1% of path length.", "open-path");
  return { points, cumulativeLengths, length, closed };
}

function wrap(value: number): number { return ((value % 1) + 1) % 1; }

export function lapPctToPathPct(lapPct: number, startFinishPathPct: number, direction: "forward" | "reverse"): number {
  if (![lapPct, startFinishPathPct].every(Number.isFinite)) throw new TrackMapValidationError("Calibration percentages must be finite.", "non-finite-coordinate");
  return wrap(startFinishPathPct + (direction === "forward" ? lapPct : -lapPct));
}

export function pathPctToLapPct(pathPct: number, startFinishPathPct: number, direction: "forward" | "reverse"): number {
  if (![pathPct, startFinishPathPct].every(Number.isFinite)) throw new TrackMapValidationError("Calibration percentages must be finite.", "non-finite-coordinate");
  const delta = direction === "forward" ? pathPct - startFinishPathPct : startFinishPathPct - pathPct;
  return wrap(delta);
}

export function pointAtPathPct(path: PreparedPath, pathPct: number): Point {
  const target = wrap(pathPct) * path.length;
  let high = path.cumulativeLengths.findIndex((value) => value >= target);
  if (high <= 0) return path.points[0]!;
  const low = high - 1;
  const span = path.cumulativeLengths[high]! - path.cumulativeLengths[low]!;
  const t = span <= 0 ? 0 : (target - path.cumulativeLengths[low]!) / span;
  return { x: lerp(path.points[low]!.x, path.points[high]!.x, t), y: lerp(path.points[low]!.y, path.points[high]!.y, t) };
}

export function nearestPathPoint(path: PreparedPath, selected: Point): { point: Point; pathPct: number; distance: number } {
  if (![selected.x, selected.y].every(Number.isFinite)) throw new TrackMapValidationError("The selected point must be finite.", "non-finite-coordinate");
  let best = { point: path.points[0]!, pathPct: 0, distance: Infinity };
  for (let index = 1; index < path.points.length; index++) {
    const a = path.points[index - 1]!, b = path.points[index]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((selected.x - a.x) * dx + (selected.y - a.y) * dy) / denominator));
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    const candidateDistance = distance(point, selected);
    if (candidateDistance < best.distance) {
      const along = path.cumulativeLengths[index - 1]! + distance(a, point);
      best = { point, pathPct: wrap(along / path.length), distance: candidateDistance };
    }
  }
  return best;
}

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const abX = b.x - a.x, abY = b.y - a.y;
  const cdX = d.x - c.x, cdY = d.y - c.y;
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) < 1e-12) return null;
  const acX = c.x - a.x, acY = c.y - a.y;
  const firstT = (acX * cdY - acY * cdX) / denominator;
  const secondT = (acX * abY - acY * abX) / denominator;
  if (firstT < 0 || firstT > 1 || secondT < 0 || secondT > 1) return null;
  return { x: a.x + abX * firstT, y: a.y + abY * firstT };
}

export interface StartFinishInference {
  pathPct: number;
  markerPaths: string[];
}

/** Locates the official start/finish marker where it crosses the selected closed centerline. */
export function inferStartFinishPathPct(centerlinePathData: string, markerSvg: string): StartFinishInference | null {
  const markerPaths = (markerSvg.match(/<path\b[^>]*>/gi) ?? []).flatMap((tag) => {
    const pathData = attr(tag, "d");
    return pathData ? [pathData] : [];
  });
  if (!markerPaths.length) return null;
  const centerline = prepareSvgPath(centerlinePathData);
  const intersections: number[] = [];
  const markerPoints: Point[] = [];
  for (const markerPath of markerPaths) {
    let marker: PreparedPath;
    try { marker = prepareSvgPath(markerPath, false); }
    catch (error) {
      if (error instanceof TrackMapValidationError) continue;
      throw error;
    }
    markerPoints.push(...marker.points);
    for (let centerIndex = 1; centerIndex < centerline.points.length; centerIndex++) {
      const centerA = centerline.points[centerIndex - 1]!, centerB = centerline.points[centerIndex]!;
      for (let markerIndex = 1; markerIndex < marker.points.length; markerIndex++) {
        const crossing = segmentIntersection(centerA, centerB, marker.points[markerIndex - 1]!, marker.points[markerIndex]!);
        if (!crossing) continue;
        const along = centerline.cumulativeLengths[centerIndex - 1]! + distance(centerA, crossing);
        intersections.push(wrap(along / centerline.length));
      }
    }
  }
  if (intersections.length) {
    const reference = intersections[0]!;
    const unwrapped = intersections.map((candidate) => reference + wrap(candidate - reference + 0.5) - 0.5);
    return { pathPct: wrap(unwrapped.reduce((sum, candidate) => sum + candidate, 0) / unwrapped.length), markerPaths };
  }
  if (!markerPoints.length) return null;
  const centroid = markerPoints.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  centroid.x /= markerPoints.length; centroid.y /= markerPoints.length;
  return { pathPct: nearestPathPoint(centerline, centroid).pathPct, markerPaths };
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find(Boolean);
}

function escapeAttribute(value: string): string { return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"); }

export function sanitizeTrackSvg(input: string): SanitizedTrackSvg {
  if (Buffer.byteLength(input, "utf8") > SVG_LIMITS.bytes) throw new TrackMapValidationError("The SVG exceeds the 1 MB import limit.", "asset-too-large");
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new TrackMapValidationError("Document type and entity declarations are not allowed.", "unsafe-svg");
  if (/<(?:script|foreignObject|iframe|object|embed|image|use|style|link|audio|video)\b/i.test(input)) throw new TrackMapValidationError("The SVG contains scripts, embedded content, CSS, or external-resource elements.", "unsafe-svg");
  if (/\son[a-z]+\s*=/i.test(input)) throw new TrackMapValidationError("Event-handler attributes are not allowed.", "unsafe-svg");
  if (/(?:href|src)\s*=|url\s*\(/i.test(input)) throw new TrackMapValidationError("External resources are not allowed.", "external-resource");
  const elementCount = (input.match(/<[a-z][^>]*>/gi) ?? []).length;
  if (elementCount > SVG_LIMITS.elements) throw new TrackMapValidationError("The SVG contains too many elements.", "element-complexity");
  const svgTag = /<svg\b[^>]*>/i.exec(input)?.[0];
  if (!svgTag) throw new TrackMapValidationError("The file is not an SVG document.", "invalid-svg");
  const viewBoxRaw = attr(svgTag, "viewBox");
  const width = Number(attr(svgTag, "width")?.replace(/[a-z%]+$/i, ""));
  const height = Number(attr(svgTag, "height")?.replace(/[a-z%]+$/i, ""));
  const viewBoxValues = viewBoxRaw?.trim().split(/[\s,]+/).map(Number);
  const viewBox: [number, number, number, number] = viewBoxValues?.length === 4
    ? viewBoxValues.map(finite) as [number, number, number, number]
    : [0, 0, finite(width), finite(height)];
  if (viewBox[2] <= 0 || viewBox[3] <= 0) throw new TrackMapValidationError("The SVG needs a finite, positive viewBox.", "invalid-view-box");
  const pathTags = input.match(/<path\b[^>]*>/gi) ?? [];
  if (pathTags.length === 0) throw new TrackMapValidationError("The SVG contains no path candidates.", "no-paths");
  if (pathTags.length > SVG_LIMITS.paths) throw new TrackMapValidationError("The SVG contains too many paths.", "path-complexity");
  const candidates: TrackMapPathCandidate[] = [];
  for (const [index, tag] of pathTags.entries()) {
    const pathData = attr(tag, "d");
    if (!pathData) continue;
    try {
      const prepared = prepareSvgPath(pathData);
      candidates.push({ id: attr(tag, "id")?.slice(0, 100) || `path-${index + 1}`, pathData, length: prepared.length, closed: prepared.closed });
    } catch (error) {
      if (error instanceof TrackMapValidationError && ["open-path", "zero-length-path", "invalid-path"].includes(error.code)) continue;
      throw error;
    }
  }
  if (candidates.length === 0) throw new TrackMapValidationError("No closed, finite centerline candidate could be extracted.", "no-usable-paths");
  const paths = candidates.map((candidate) => `<path id="${escapeAttribute(candidate.id)}" d="${escapeAttribute(candidate.pathData)}" fill="none" vector-effect="non-scaling-stroke"/>`).join("");
  return {
    checksum: createHash("sha256").update(input).digest("hex"),
    sanitizedSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}">${paths}</svg>`,
    viewBox,
    candidates,
  };
}
