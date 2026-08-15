import { createHash } from "node:crypto";
import type { TrackLayoutIdentity } from "@racecontrol/protocol";
import { pointAtPathPct, prepareSvgPath, type PreparedPath } from "./track-map-geometry.js";

const TOKEN_URL = "https://oauth.iracing.com/oauth2/token";
const TRACK_ASSETS_URL = "https://members-ng.iracing.com/data/track/assets";
const IMAGE_ROOT = "https://images-static.iracing.com/";
const OFFICIAL_IMAGE_HOSTS = new Set(["images-static.iracing.com", "members-assets.iracing.com"]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SVG_BYTES = 1_000_000;

export interface IracingCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

interface StoredTokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

interface TrackAsset {
  track_id?: unknown;
  track_map?: unknown;
  track_map_layers?: unknown;
  folder?: unknown;
}

export interface IracingTrackMapAsset {
  svg: string;
  startFinishSvg?: string;
  sourceUrl: string;
  sourceVersion: string;
  originalFilename: string;
}

export class IracingTrackMapError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 502) {
    super(message);
  }
}

export function iracingCredentialsFromEnvironment(environment: NodeJS.ProcessEnv): IracingCredentials | null {
  const values = {
    clientId: environment.IRACING_CLIENT_ID?.trim(),
    clientSecret: environment.IRACING_CLIENT_SECRET?.trim(),
    username: environment.IRACING_USERNAME?.trim(),
    password: environment.IRACING_PASSWORD,
  };
  return values.clientId && values.clientSecret && values.username && values.password ? values as IracingCredentials : null;
}

export function maskIracingSecret(secret: string, identifier: string): string {
  return createHash("sha256").update(`${secret}${identifier.trim().toLowerCase()}`).digest("base64");
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const value = body as Record<string, unknown>;
  return typeof value.error_description === "string" ? value.error_description
    : typeof value.error === "string" ? value.error
      : fallback;
}

function finiteSeconds(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 600;
}

function isTokenResponse(value: unknown): value is TokenResponse {
  return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>).access_token === "string");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assetForTrack(payload: unknown, trackId: number): TrackAsset | null {
  const root = record(payload);
  if (!root) return null;
  const keyed = record(root[String(trackId)]);
  if (keyed) return keyed;
  return Object.values(root).map(record).find((candidate) => Number(candidate?.track_id) === trackId) ?? null;
}

function mapLayerUrl(asset: TrackAsset, layerName: string): URL | null {
  const layers = record(asset.track_map_layers);
  const trackMap = typeof asset.track_map === "string" && asset.track_map.trim() ? officialImageUrl(asset.track_map) : null;
  const layer = typeof layers?.[layerName] === "string" && layers[layerName].trim() ? layers[layerName] as string : null;
  if (!layer) return layerName === "active" ? trackMap : null;
  if (!trackMap) throw new IracingTrackMapError("iRacing published a map layer without its base map URL.", "invalid-asset-url");
  return validateOfficialImageUrl(new URL(layer, trackMap));
}

function validateOfficialImageUrl(url: URL): URL {
  if (url.protocol !== "https:" || !OFFICIAL_IMAGE_HOSTS.has(url.hostname)) {
    throw new IracingTrackMapError(`iRacing returned an invalid track-map asset host (${url.hostname || "missing"}).`, "invalid-asset-url");
  }
  return url;
}

function officialImageUrl(path: string): URL {
  const url = new URL(path.replace(/^\/+/, ""), IMAGE_ROOT);
  return validateOfficialImageUrl(url);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((value) => value !== undefined);
}

function escaped(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** Reduces an official layer to the same inert path-only input accepted for local uploads. */
export function pathOnlyOfficialSvg(input: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new IracingTrackMapError("The iRacing SVG contains unsupported declarations.", "unsafe-svg", 400);
  const svgTag = /<svg\b[^>]*>/i.exec(input)?.[0];
  if (!svgTag) throw new IracingTrackMapError("The iRacing map is not an SVG document.", "invalid-svg", 400);
  const viewBox = attribute(svgTag, "viewBox");
  const width = attribute(svgTag, "width");
  const height = attribute(svgTag, "height");
  const dimensions = viewBox ? `viewBox="${escaped(viewBox)}"`
    : `width="${escaped(width ?? "")}" height="${escaped(height ?? "")}"`;
  const paths = (input.match(/<path\b[^>]*>/gi) ?? []).flatMap((tag, index) => {
    const d = attribute(tag, "d");
    if (!d) return [];
    return [`<path id="iracing-path-${index + 1}" d="${escaped(d)}"/>`];
  });
  if (!paths.length) throw new IracingTrackMapError("The iRacing SVG contains no path geometry.", "no-paths", 400);
  return `<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}>${paths.join("")}</svg>`;
}

function splitSubpaths(pathData: string): string[] {
  const starts = [...pathData.matchAll(/[Mm]/g)].map((match) => match.index ?? 0);
  return starts.map((start, index) => pathData.slice(start, starts[index + 1] ?? pathData.length).trim()).filter(Boolean);
}

function alignedBoundaryPoints(first: PreparedPath, second: PreparedPath, count: number): { first: { x: number; y: number }[]; second: { x: number; y: number }[]; averageGap: number } {
  const firstPoints = Array.from({ length: count }, (_, index) => pointAtPathPct(first, index / count));
  const secondPoints = Array.from({ length: count }, (_, index) => pointAtPathPct(second, index / count));
  let best = { score: Infinity, reverse: false, shift: 0 };
  for (const reverse of [false, true]) {
    for (let shift = 0; shift < count; shift++) {
      let score = 0;
      for (let index = 0; index < count; index++) {
        const secondIndex = ((shift + (reverse ? -index : index)) % count + count) % count;
        const dx = firstPoints[index]!.x - secondPoints[secondIndex]!.x;
        const dy = firstPoints[index]!.y - secondPoints[secondIndex]!.y;
        score += dx * dx + dy * dy;
      }
      if (score < best.score) best = { score, reverse, shift };
    }
  }
  const alignedSecond = firstPoints.map((_, index) => secondPoints[((best.shift + (best.reverse ? -index : index)) % count + count) % count]!);
  return { first: firstPoints, second: alignedSecond, averageGap: Math.sqrt(best.score / count) };
}

function coordinate(value: number): string { return Number(value.toFixed(3)).toString(); }

/** Converts iRacing's filled track ribbon into one closed geometric centerline. */
export function centerlineOnlyOfficialSvg(input: string): string {
  const reduced = pathOnlyOfficialSvg(input);
  const svgTag = /<svg\b[^>]*>/i.exec(reduced)?.[0];
  const viewBoxValues = attribute(svgTag ?? "", "viewBox")?.trim().split(/[\s,]+/).map(Number);
  const boundaries = (reduced.match(/<path\b[^>]*>/gi) ?? []).flatMap((tag) => {
    const pathData = attribute(tag, "d");
    return pathData ? splitSubpaths(pathData) : [];
  }).flatMap((pathData) => {
    try { return [prepareSvgPath(pathData)]; }
    catch { return []; }
  });
  if (boundaries.length !== 2) return reduced;
  const [first, second] = boundaries;
  const aligned = alignedBoundaryPoints(first!, second!, 256);
  const viewBoxScale = viewBoxValues?.length === 4 ? Math.min(viewBoxValues[2]!, viewBoxValues[3]!) : Infinity;
  if (!Number.isFinite(aligned.averageGap) || aligned.averageGap <= 0 || aligned.averageGap > viewBoxScale * 0.15) return reduced;
  const centerPoints = aligned.first.map((point, index) => ({
    x: (point.x + aligned.second[index]!.x) / 2,
    y: (point.y + aligned.second[index]!.y) / 2,
  }));
  const pathData = centerPoints.map((point, index) => `${index ? "L" : "M"}${coordinate(point.x)},${coordinate(point.y)}`).join("") + "Z";
  const dimensions = svgTag?.slice(4, -1).trim() ?? "";
  return `<svg ${dimensions}><path id="iracing-centerline" d="${pathData}"/></svg>`;
}

type Matrix = [number, number, number, number, number, number];

function transformMatrix(value: string | undefined): Matrix {
  let result: Matrix = [1, 0, 0, 1, 0, 0];
  const multiply = (left: Matrix, right: Matrix): Matrix => [
    left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  for (const match of value?.matchAll(/(matrix|translate|scale|rotate)\(([^)]+)\)/g) ?? []) {
    const args = match[2]!.trim().split(/[\s,]+/).map(Number);
    if (!args.length || args.some((item) => !Number.isFinite(item))) continue;
    let next: Matrix;
    if (match[1] === "matrix" && args.length === 6) next = args as Matrix;
    else if (match[1] === "translate") next = [1, 0, 0, 1, args[0]!, args[1] ?? 0];
    else if (match[1] === "scale") next = [args[0]!, 0, 0, args[1] ?? args[0]!, 0, 0];
    else if (match[1] === "rotate") {
      const radians = args[0]! * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
      const centerX = args[1] ?? 0, centerY = args[2] ?? 0;
      next = [cosine, sine, -sine, cosine, centerX * (1 - cosine) + centerY * sine, centerY * (1 - cosine) - centerX * sine];
    } else continue;
    result = multiply(result, next);
  }
  return result;
}

function transformedPoint(matrix: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function finiteAttribute(tag: string, name: string): number {
  const value = Number(attribute(tag, name) ?? 0);
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new IracingTrackMapError("The iRacing S/F layer contains invalid coordinates.", "invalid-svg", 400);
  return value;
}

function lineFromTag(tag: string, parentTransform?: string): string {
  const matrix = transformMatrix(`${parentTransform ?? ""} ${attribute(tag, "transform") ?? ""}`);
  const start = transformedPoint(matrix, finiteAttribute(tag, "x1"), finiteAttribute(tag, "y1"));
  const end = transformedPoint(matrix, finiteAttribute(tag, "x2"), finiteAttribute(tag, "y2"));
  return `M${start.x},${start.y}L${end.x},${end.y}`;
}

function centerlineFromRect(tag: string, parentTransform?: string): string {
  const x = finiteAttribute(tag, "x"), y = finiteAttribute(tag, "y");
  const width = finiteAttribute(tag, "width"), height = finiteAttribute(tag, "height");
  if (width <= 0 || height <= 0) throw new IracingTrackMapError("The iRacing S/F layer contains an invalid rectangle.", "invalid-svg", 400);
  const horizontal = width > height;
  const rawStart = horizontal ? { x, y: y + height / 2 } : { x: x + width / 2, y };
  const rawEnd = horizontal ? { x: x + width, y: y + height / 2 } : { x: x + width / 2, y: y + height };
  const matrix = transformMatrix(`${parentTransform ?? ""} ${attribute(tag, "transform") ?? ""}`);
  const start = transformedPoint(matrix, rawStart.x, rawStart.y), end = transformedPoint(matrix, rawEnd.x, rawEnd.y);
  return `M${start.x},${start.y}L${end.x},${end.y}`;
}

function useTransform(useTag: string): string {
  const x = finiteAttribute(useTag, "x");
  const y = finiteAttribute(useTag, "y");
  return `${attribute(useTag, "transform") ?? ""} translate(${x} ${y})`;
}

/** Converts iRacing's heterogeneous S/F artwork to one inert line path. */
export function startFinishOnlyOfficialSvg(input: string): string {
  if (/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\son[a-z]+\s*=/i.test(input))
    throw new IracingTrackMapError("The iRacing S/F layer contains unsupported active content.", "unsafe-svg", 400);
  const svgTag = /<svg\b[^>]*>/i.exec(input)?.[0];
  if (!svgTag) throw new IracingTrackMapError("The iRacing S/F layer is not an SVG document.", "invalid-svg", 400);
  const viewBox = attribute(svgTag, "viewBox");
  const width = attribute(svgTag, "width"), height = attribute(svgTag, "height");
  const dimensions = viewBox ? `viewBox="${escaped(viewBox)}"` : `width="${escaped(width ?? "")}" height="${escaped(height ?? "")}"`;
  let linePath: string | undefined;
  for (const useTag of input.match(/<use\b[^>]*>/gi) ?? []) {
    const reference = attribute(useTag, "href") ?? attribute(useTag, "xlink:href");
    if (!reference?.startsWith("#")) continue;
    const symbolId = reference.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const symbol = new RegExp(`<symbol\\b[^>]*\\bid\\s*=\\s*(?:"${symbolId}"|'${symbolId}')[^>]*>([\\s\\S]*?)<\\/symbol>`, "i").exec(input)?.[1];
    if (!symbol) continue;
    const rect = /<rect\b[^>]*>/i.exec(symbol)?.[0];
    const line = /<line\b[^>]*>/i.exec(symbol)?.[0];
    if (rect) { linePath = centerlineFromRect(rect, useTransform(useTag)); break; }
    if (line) { linePath = lineFromTag(line, useTransform(useTag)); break; }
  }
  const directContent = input
    .replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/gi, "")
    .replace(/<symbol\b[^>]*>[\s\S]*?<\/symbol>/gi, "");
  const directLine = /<line\b[^>]*>/i.exec(directContent)?.[0];
  const directRect = /<rect\b[^>]*>/i.exec(directContent)?.[0];
  const directPath = /<path\b[^>]*>/i.exec(directContent)?.[0];
  linePath ??= directLine ? lineFromTag(directLine) : directRect ? centerlineFromRect(directRect) : directPath ? attribute(directPath, "d") : undefined;
  if (!linePath) throw new IracingTrackMapError("The iRacing S/F layer contains no supported line geometry.", "no-paths", 400);
  return `<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}><path id="iracing-start-finish-line" d="${escaped(linePath)}"/></svg>`;
}

export class IracingTrackMapClient {
  private tokens: StoredTokens | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(
    private readonly credentials: IracingCredentials,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async postToken(parameters: URLSearchParams): Promise<StoredTokens> {
    const response = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: parameters,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isTokenResponse(body)) {
      throw new IracingTrackMapError(`iRacing authentication failed: ${errorMessage(body, response.statusText || "invalid response")}.`, "authentication-failed", 502);
    }
    const issuedAt = this.now();
    return {
      accessToken: body.access_token,
      accessExpiresAt: issuedAt + finiteSeconds(body.expires_in) * 1_000,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      refreshExpiresAt: typeof body.refresh_token === "string" ? issuedAt + finiteSeconds(body.refresh_token_expires_in ?? 604_800) * 1_000 : undefined,
    };
  }

  private async authenticate(): Promise<StoredTokens> {
    const { clientId, clientSecret, username, password } = this.credentials;
    return this.postToken(new URLSearchParams({
      grant_type: "password_limited",
      client_id: clientId,
      client_secret: maskIracingSecret(clientSecret, clientId),
      username,
      password: maskIracingSecret(password, username),
      scope: "iracing.auth",
    }));
  }

  private async refresh(refreshToken: string): Promise<StoredTokens> {
    const { clientId, clientSecret } = this.credentials;
    return this.postToken(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: maskIracingSecret(clientSecret, clientId),
      refresh_token: refreshToken,
    }));
  }

  private async accessToken(): Promise<string> {
    const buffer = 10_000;
    if (this.tokens && this.tokens.accessExpiresAt > this.now() + buffer) return this.tokens.accessToken;
    if (!this.tokenRequest) {
      this.tokenRequest = (async () => {
        const canRefresh = this.tokens?.refreshToken && (this.tokens.refreshExpiresAt ?? 0) > this.now() + buffer;
        try {
          this.tokens = canRefresh ? await this.refresh(this.tokens!.refreshToken!) : await this.authenticate();
        } catch (error) {
          if (!canRefresh) throw error;
          this.tokens = await this.authenticate();
        }
        return this.tokens.accessToken;
      })().finally(() => { this.tokenRequest = null; });
    }
    return this.tokenRequest;
  }

  private async fetch(url: string | URL, init?: RequestInit): Promise<Response> {
    try {
      return await this.request(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new IracingTrackMapError(`Could not reach iRacing: ${error instanceof Error ? error.message : "network request failed"}.`, "iracing-unavailable", 502);
    }
  }

  private async dataPayload(): Promise<unknown> {
    const token = await this.accessToken();
    let response = await this.fetch(TRACK_ASSETS_URL, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (response.status === 401) {
      this.tokens = null;
      response = await this.fetch(TRACK_ASSETS_URL, { headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: "application/json" } });
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new IracingTrackMapError(`iRacing track assets failed: ${errorMessage(body, response.statusText || "invalid response")}.`, "assets-failed", 502);
    const link = record(body)?.link;
    if (typeof link !== "string") return body;
    const dataUrl = new URL(link);
    if (dataUrl.protocol !== "https:") throw new IracingTrackMapError("iRacing returned an insecure data link.", "invalid-data-url");
    const linked = await this.fetch(dataUrl, { headers: { Accept: "application/json" } });
    const payload: unknown = await linked.json().catch(() => null);
    if (!linked.ok) throw new IracingTrackMapError("The linked iRacing track-asset catalog could not be downloaded.", "assets-failed", 502);
    return payload;
  }

  async getTrackMap(layout: TrackLayoutIdentity): Promise<IracingTrackMapAsset> {
    if (!Number.isInteger(layout.trackId) || Number(layout.trackId) <= 0) {
      throw new IracingTrackMapError("The live session does not provide an iRacing track ID.", "track-id-required", 400);
    }
    const trackId = Number(layout.trackId);
    const asset = assetForTrack(await this.dataPayload(), trackId);
    if (!asset) throw new IracingTrackMapError(`iRacing has no asset record for track layout ${trackId}.`, "asset-not-found", 404);
    const sourceUrl = mapLayerUrl(asset, "active");
    if (!sourceUrl) throw new IracingTrackMapError(`iRacing does not publish an SVG map for track layout ${trackId}.`, "map-not-found", 404);
    const response = await this.fetch(sourceUrl, { headers: { Accept: "image/svg+xml, text/plain;q=0.8" } });
    if (!response.ok) throw new IracingTrackMapError(`The iRacing SVG map could not be downloaded (${response.status}).`, "map-download-failed", 502);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SVG_BYTES) throw new IracingTrackMapError("The iRacing SVG exceeds Gantry's 1 MB map limit.", "asset-too-large", 400);
    const svg = await response.text();
    if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) throw new IracingTrackMapError("The iRacing SVG exceeds Gantry's 1 MB map limit.", "asset-too-large", 400);
    let startFinishSvg: string | undefined;
    try {
      const startFinishUrl = mapLayerUrl(asset, "start-finish");
      if (startFinishUrl) {
        const markerResponse = await this.fetch(startFinishUrl, { headers: { Accept: "image/svg+xml, text/plain;q=0.8" } });
        const declaredMarkerLength = Number(markerResponse.headers.get("content-length"));
        if (markerResponse.ok && (!Number.isFinite(declaredMarkerLength) || declaredMarkerLength <= MAX_SVG_BYTES)) {
          const markerSvg = await markerResponse.text();
          if (Buffer.byteLength(markerSvg, "utf8") <= MAX_SVG_BYTES) {
            try { startFinishSvg = startFinishOnlyOfficialSvg(markerSvg); }
            catch { startFinishSvg = undefined; }
          }
        }
      }
    } catch { startFinishSvg = undefined; }
    const basename = sourceUrl.pathname.split("/").pop() || `track-${trackId}.svg`;
    return {
      svg: centerlineOnlyOfficialSvg(svg),
      startFinishSvg,
      sourceUrl: sourceUrl.href,
      sourceVersion: createHash("sha256").update(svg).digest("hex").slice(0, 16),
      originalFilename: `iRacing-${trackId}-${basename}`.slice(0, 240),
    };
  }
}
