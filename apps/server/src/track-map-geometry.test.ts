import assert from "node:assert/strict";
import test from "node:test";
import {
  lapPctToPathPct,
  nearestPathPoint,
  pathPctToLapPct,
  pointAtPathPct,
  prepareSvgPath,
  sanitizeTrackSvg,
  SVG_LIMITS,
  TrackMapValidationError,
} from "./track-map-geometry.js";

const square = "M 0 0 L 100 0 L 100 100 L 0 100 Z";

test("maps forward lap percentages through start/finish and wraps", () => {
  assert.equal(lapPctToPathPct(0, 0.25, "forward"), 0.25);
  assert.equal(lapPctToPathPct(0.9, 0.25, "forward"), 0.1499999999999999);
  assert.equal(pathPctToLapPct(0.15, 0.25, "forward"), 0.9);
});

test("maps reversed travel and inverse projection", () => {
  assert.ok(Math.abs(lapPctToPathPct(0.1, 0.25, "reverse") - 0.15) < 1e-12);
  assert.ok(Math.abs(pathPctToLapPct(0.15, 0.25, "reverse") - 0.1) < 1e-12);
});

test("resolves points by normalized length and nearest point", () => {
  const path = prepareSvgPath(square);
  assert.deepEqual(pointAtPathPct(path, 0.125), { x: 50, y: 0 });
  const nearest = nearestPathPoint(path, { x: 52, y: 8 });
  assert.deepEqual(nearest.point, { x: 52, y: 0 });
  assert.ok(Math.abs(nearest.pathPct - 0.13) < 0.000_001);
});

test("requires a closed, nonzero finite path", () => {
  assert.throws(() => prepareSvgPath("M0 0 L10 0"), (error: unknown) => error instanceof TrackMapValidationError && error.code === "open-path");
  assert.throws(() => prepareSvgPath("M0 0 L0 0 Z"), (error: unknown) => error instanceof TrackMapValidationError && error.code === "zero-length-path");
  assert.throws(() => prepareSvgPath("M0 0 L1e999 0 Z"), (error: unknown) => error instanceof TrackMapValidationError && error.code === "non-finite-coordinate");
});

test("sanitizes a simple SVG into inert path-only markup", () => {
  const result = sanitizeTrackSvg(`<svg viewBox="0 0 100 100"><g><path id="centerline" d="${square}" stroke="red"/></g></svg>`);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.id, "centerline");
  assert.match(result.sanitizedSvg, /vector-effect="non-scaling-stroke"/);
  assert.doesNotMatch(result.sanitizedSvg, /stroke="red"/);
});

test("rejects active content, handlers, external resources, oversized and excessive assets", () => {
  for (const svg of [
    `<svg viewBox="0 0 10 10"><script>alert(1)</script><path d="${square}"/></svg>`,
    `<svg viewBox="0 0 10 10"><path onclick="alert(1)" d="${square}"/></svg>`,
    `<svg viewBox="0 0 10 10"><image href="https://example.test/a.png"/><path d="${square}"/></svg>`,
  ]) assert.throws(() => sanitizeTrackSvg(svg), TrackMapValidationError);
  assert.throws(() => sanitizeTrackSvg(`<svg>${" ".repeat(SVG_LIMITS.bytes)}</svg>`), (error: unknown) => error instanceof TrackMapValidationError && error.code === "asset-too-large");
  const excessive = `<svg viewBox="0 0 100 100">${Array.from({ length: SVG_LIMITS.paths + 1 }, () => `<path d="${square}"/>`).join("")}</svg>`;
  assert.throws(() => sanitizeTrackSvg(excessive), (error: unknown) => error instanceof TrackMapValidationError && error.code === "path-complexity");
});
