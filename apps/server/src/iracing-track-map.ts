import { createHash } from "node:crypto";
import type { TrackLayoutIdentity } from "@racecontrol/protocol";

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

function mapUrl(asset: TrackAsset): URL | null {
  const layers = record(asset.track_map_layers);
  const trackMap = typeof asset.track_map === "string" && asset.track_map.trim() ? officialImageUrl(asset.track_map) : null;
  const activeLayer = typeof layers?.active === "string" && layers.active.trim() ? layers.active : null;
  if (!activeLayer) return trackMap;
  if (!trackMap) throw new IracingTrackMapError("iRacing published a map layer without its base map URL.", "invalid-asset-url");
  return validateOfficialImageUrl(new URL(activeLayer, trackMap));
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
    const sourceUrl = mapUrl(asset);
    if (!sourceUrl) throw new IracingTrackMapError(`iRacing does not publish an SVG map for track layout ${trackId}.`, "map-not-found", 404);
    const response = await this.fetch(sourceUrl, { headers: { Accept: "image/svg+xml, text/plain;q=0.8" } });
    if (!response.ok) throw new IracingTrackMapError(`The iRacing SVG map could not be downloaded (${response.status}).`, "map-download-failed", 502);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SVG_BYTES) throw new IracingTrackMapError("The iRacing SVG exceeds Gantry's 1 MB map limit.", "asset-too-large", 400);
    const svg = await response.text();
    if (Buffer.byteLength(svg, "utf8") > MAX_SVG_BYTES) throw new IracingTrackMapError("The iRacing SVG exceeds Gantry's 1 MB map limit.", "asset-too-large", 400);
    const basename = sourceUrl.pathname.split("/").pop() || `track-${trackId}.svg`;
    return {
      svg: pathOnlyOfficialSvg(svg),
      sourceUrl: sourceUrl.href,
      sourceVersion: createHash("sha256").update(svg).digest("hex").slice(0, 16),
      originalFilename: `iRacing-${trackId}-${basename}`.slice(0, 240),
    };
  }
}
