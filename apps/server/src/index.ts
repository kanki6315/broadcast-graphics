import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, SectorBoundary, ServerMessage, TrackLayoutIdentity } from "@racecontrol/protocol";
import { createAuthenticationStore } from "./auth-store.js";
import { loadClientRelease, streamClientRelease } from "./client-release.js";
import { IracingTrackMapClient, IracingTrackMapError, iracingCredentialsFromEnvironment } from "./iracing-track-map.js";
import { PackageRegistry } from "./package-registry.js";
import { createRaceHistoryRepository, RaceHistoryService } from "./race-history-store.js";
import { RaceIntelligenceService } from "./race-intelligence-service.js";
import { startSimulator } from "./simulator.js";
import { broadcastStateSnapshot, type SocketRole } from "./socket-broadcast.js";
import { canIssueControlCommands, helloMatchesAccess, parseSocketAccess } from "./socket-access.js";
import { acceptTelemetry } from "./telemetry-ingestion.js";
import { StateStore } from "./state-store.js";
import { inferStartFinishPathPct } from "./track-map-geometry.js";
import {
  configurationError,
  createTrackConfigurationRepository,
  sessionLayout,
} from "./track-configuration-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const packageRoot = resolve(projectRoot, "graphic-packages");
const webRoot = resolve(projectRoot, "apps/web/dist");
const authDataPath = process.env.AUTH_DATA_PATH ?? resolve(projectRoot, "apps/server/data/auth.json");
const clientReleaseRoot = process.env.CLIENT_RELEASE_ROOT ?? resolve(projectRoot, "client-release");

const app = Fastify({ logger: true });
const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_PASSWORD is required in production.");
  adminPassword = randomBytes(18).toString("base64url");
  app.log.warn(`Development admin login — username: ${adminUsername} password: ${adminPassword}`);
}
const auth = createAuthenticationStore({
  databaseUrl: process.env.DATABASE_URL,
  dataPath: authDataPath,
  adminUsername,
  adminPassword,
  production: process.env.NODE_ENV === "production",
});
await auth.initialize();
const historyRepository = createRaceHistoryRepository(process.env.DATABASE_URL);
await historyRepository.initialize();
const trackConfiguration = createTrackConfigurationRepository(process.env.DATABASE_URL);
await trackConfiguration.initialize();
const iracingCredentials = iracingCredentialsFromEnvironment(process.env);
const iracingTrackMaps = iracingCredentials ? new IracingTrackMapClient(iracingCredentials) : null;
const registry = new PackageRegistry(packageRoot);
const packages = await registry.list();
const clientRelease = await loadClientRelease(clientReleaseRoot);
const defaultPackageId = packages.find((candidate) => candidate.id === "pri-hoosier-500")?.id
  ?? packages[0]?.id
  ?? "pri-hoosier-500";
const store = new StateStore(defaultPackageId);
const sockets = new Map<WebSocket, SocketRole>();
const cameraSockets = new Set<WebSocket>();
const sentSectorRevisions = new Map<WebSocket, string | null>();
const history = new RaceHistoryService(
  historyRepository,
  (lap) => broadcastStateSnapshot(sockets, { type: "lap.completed", payload: lap }),
  (error) => app.log.error({ err: error }, "Failed to persist completed lap"),
);
const intelligence = new RaceIntelligenceService();
const loginAttempts = new Map<string, { count: number; resetsAt: number }>();

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries((header ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

function sessionToken(cookieHeader: string | undefined): string | undefined {
  return parseCookies(cookieHeader).bg_session;
}

function bearerToken(header: string | undefined): string | undefined {
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
}

function viewToken(header: string | undefined): string | undefined {
  return header?.split(",").map((value) => value.trim()).find((value) => value.startsWith("bg_view_"));
}

function setSessionCookie(reply: { header(name: string, value: string): unknown }, token: string, maxAge = 43_200): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `bg_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

async function requireAdmin(request: { headers: { cookie?: string } }, reply: { code(status: number): { send(body: unknown): unknown } }): Promise<{ username: string } | null> {
  const admin = await auth.validateSession(sessionToken(request.headers.cookie));
  if (!admin) reply.code(401).send({ error: "Authentication required." });
  return admin;
}

function currentLayout(): TrackLayoutIdentity | null {
  const session = store.snapshot().session;
  return session ? sessionLayout(session) : null;
}

function requestedLayout(value: unknown): TrackLayoutIdentity {
  if (!value || typeof value !== "object") throw new Error("Track layout identity is required.");
  const input = value as Record<string, unknown>;
  return {
    trackId: typeof input.trackId === "number" ? input.trackId : null,
    configurationId: typeof input.configurationId === "number" ? input.configurationId : null,
    trackName: typeof input.trackName === "string" ? input.trackName : "",
    configurationName: typeof input.configurationName === "string" ? input.configurationName : null,
    trackLengthMeters: typeof input.trackLengthMeters === "number" ? input.trackLengthMeters : null,
  };
}

function sendConfigurationFailure(reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown): unknown {
  const normalized = configurationError(error);
  return reply.code("status" in normalized ? normalized.status : 400).send({ error: normalized.message, code: normalized.code });
}

async function refreshTrackConfiguration(): Promise<void> {
  const layout = currentLayout();
  store.trackConfiguration(layout ? await trackConfiguration.snapshot(layout) : null);
}

async function activeSectorMessage(): Promise<Extract<ServerMessage, { type: "sector.definition" }>> {
  const layout = currentLayout();
  if (!layout) return { type: "sector.definition", payload: null };
  const snapshot = await trackConfiguration.snapshot(layout);
  const active = snapshot.activeSectorDefinition;
  const session = store.snapshot().session;
  return {
    type: "sector.definition",
    payload: active?.source === "custom" && session ? {
      revision: active.revision, source: "custom", sessionId: session.id, trackId: layout.trackId,
      trackName: layout.trackName, boundaries: active.boundaries, layout,
      mapCalibrationId: active.mapCalibrationId, mapCalibrationRevision: active.mapCalibrationRevision,
    } : null,
  };
}

await app.register(fastifyStatic, {
  root: packageRoot,
  prefix: "/packages/",
  decorateReply: false,
});

if (existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: "/",
    wildcard: false,
  });
}

app.get("/api/health", async () => ({ ok: true, revision: store.snapshot().revision }));
app.get("/api/client/latest", async (_request, reply) => {
  if (!clientRelease) return reply.code(404).send({ error: "No Windows client release is available." });
  reply.header("Cache-Control", "no-store");
  return clientRelease.manifest;
});
app.get("/api/client/download", async (_request, reply) => {
  if (!clientRelease) return reply.code(404).send({ error: "No Windows client release is available." });
  reply
    .header("Cache-Control", "no-store")
    .header("Content-Disposition", 'attachment; filename="BroadcastGraphicsClient.exe"')
    .header("Content-Length", clientRelease.manifest.size)
    .type("application/vnd.microsoft.portable-executable");
  return reply.send(streamClientRelease(clientRelease));
});
app.post<{ Body: { username?: unknown; password?: unknown } }>("/api/auth/login", async (request, reply) => {
  const now = Date.now();
  const current = loginAttempts.get(request.ip);
  const attempts = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + 5 * 60_000 } : current;
  if (attempts.count >= 5) return reply.code(429).send({ error: "Too many login attempts. Try again in a few minutes." });

  const username = typeof request.body?.username === "string" ? request.body.username.slice(0, 100) : "";
  const password = typeof request.body?.password === "string" ? request.body.password.slice(0, 1_000) : "";
  if (!auth.authenticateAdmin(username, password)) {
    attempts.count += 1;
    loginAttempts.set(request.ip, attempts);
    return reply.code(401).send({ error: "The username or password is incorrect." });
  }

  loginAttempts.delete(request.ip);
  setSessionCookie(reply, await auth.createSession());
  return { username };
});

app.get("/api/auth/me", async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  return admin ?? undefined;
});

app.post("/api/auth/logout", async (request, reply) => {
  await auth.revokeSession(sessionToken(request.headers.cookie));
  setSessionCookie(reply, "", 0);
  return { ok: true };
});

app.get("/api/auth/keys", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  return await auth.listKeys();
});

app.post<{ Body: { kind?: unknown; label?: unknown } }>("/api/auth/keys", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  const kind = request.body?.kind;
  const label = typeof request.body?.label === "string" ? request.body.label.trim().slice(0, 80) : "";
  if ((kind !== "ingestion" && kind !== "view") || !label) {
    return reply.code(400).send({ error: "Choose a key type and provide a label." });
  }
  return reply.code(201).send(await auth.createKey(kind, label));
});

app.delete<{ Params: { id: string } }>("/api/auth/keys/:id", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  if (!await auth.revokeKey(request.params.id)) return reply.code(404).send({ error: "Active key not found." });
  return { ok: true };
});

app.get("/api/state", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  return store.snapshot();
});
app.get<{ Querystring: { carIdx?: string; limit?: string } }>("/api/history/laps", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  const session = store.snapshot().session;
  const carIdx = Number(request.query.carIdx);
  const limit = request.query.limit == null ? 20 : Number(request.query.limit);
  if (!session || !Number.isInteger(carIdx) || !Number.isInteger(limit)) {
    return reply.code(400).send({ error: "An active session, integer carIdx, and integer limit are required." });
  }
  return history.listLaps(session, carIdx, limit);
});

app.get("/api/track-config/active", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  const layout = currentLayout();
  if (!layout) return reply.code(404).send({ error: "No active track layout is available." });
  return trackConfiguration.snapshot(layout);
});

app.get<{ Params: { id: string } }>("/api/track-config/maps/:id", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  const map = await trackConfiguration.getMap(request.params.id);
  if (!map) return reply.code(404).send({ error: "Track map not found." });
  reply.header("Cache-Control", "private, max-age=3600, immutable");
  return map;
});

app.get<{ Params: { id: string } }>("/api/track-config/calibrations/:id", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  const calibration = await trackConfiguration.getCalibration(request.params.id);
  if (!calibration) return reply.code(404).send({ error: "Track-map calibration not found." });
  reply.header("Cache-Control", "private, max-age=3600, immutable");
  return calibration;
});

app.post<{ Body: { svg?: unknown } }>("/api/track-config/import-preview", { bodyLimit: 1_050_000 }, async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  try {
    if (typeof request.body?.svg !== "string") return reply.code(400).send({ error: "SVG text is required." });
    return await trackConfiguration.previewImport(request.body.svg);
  } catch (error) { return sendConfigurationFailure(reply, error); }
});

app.post<{ Body: { layout?: unknown } }>("/api/track-config/maps/iracing", async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return;
  if (!iracingTrackMaps) return reply.code(503).send({
    error: "iRacing map import is not configured on the server.",
    code: "iracing-not-configured",
  });
  try {
    const layout = request.body?.layout ? requestedLayout(request.body.layout) : currentLayout();
    if (!layout) return reply.code(404).send({ error: "No active track layout is available." });
    const asset = await iracingTrackMaps.getTrackMap(layout);
    const preview = await trackConfiguration.previewImport(asset.svg);
    const selected = preview.candidates[0];
    if (!selected) return reply.code(422).send({ error: "The iRacing SVG contains no usable closed centerline." });
    if (preview.candidates.length > 1) return reply.code(422).send({
      error: `The iRacing SVG contains ${preview.candidates.length} closed paths, so Gantry will not guess which one is the centerline. Download the official layer and use local SVG import to choose it explicitly.`,
      code: "ambiguous-centerline",
    });
    let startFinish: ReturnType<typeof inferStartFinishPathPct> = null;
    if (asset.startFinishSvg) {
      try { startFinish = inferStartFinishPathPct(selected.pathData, asset.startFinishSvg); }
      catch { startFinish = null; }
    }
    const map = await trackConfiguration.importMap({
      svg: asset.svg,
      layout,
      selectedPathId: selected.id,
      source: "iracing",
      sourceVersion: asset.sourceVersion,
      originalFilename: asset.originalFilename,
      suggestedStartFinishPathPct: startFinish?.pathPct,
      startFinishMarkerPaths: startFinish?.markerPaths,
      author: admin.username,
    });
    return reply.code(201).send(map);
  } catch (error) {
    if (error instanceof IracingTrackMapError) return reply.code(error.status).send({ error: error.message, code: error.code });
    return sendConfigurationFailure(reply, error);
  }
});

app.post<{ Body: Record<string, unknown> }>("/api/track-config/maps", { bodyLimit: 1_100_000 }, async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return;
  try {
    const body = request.body ?? {};
    if (typeof body.svg !== "string" || typeof body.selectedPathId !== "string") return reply.code(400).send({ error: "SVG text and a selected centerline are required." });
    const map = await trackConfiguration.importMap({
      svg: body.svg, layout: requestedLayout(body.layout), selectedPathId: body.selectedPathId,
      source: body.source === "iracing" || body.source === "bundled" ? body.source : "imported",
      sourceVersion: typeof body.sourceVersion === "string" ? body.sourceVersion : undefined,
      originalFilename: typeof body.originalFilename === "string" ? body.originalFilename : undefined,
      author: admin.username,
    });
    return reply.code(201).send(map);
  } catch (error) { return sendConfigurationFailure(reply, error); }
});

app.get<{ Querystring: { layout?: string } }>("/api/track-config/maps", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  try {
    const layout = request.query.layout ? requestedLayout(JSON.parse(request.query.layout)) : currentLayout();
    if (!layout) return reply.code(404).send({ error: "No active track layout is available." });
    return trackConfiguration.listMaps(layout);
  } catch (error) { return sendConfigurationFailure(reply, error); }
});

app.post<{ Body: Record<string, unknown> }>("/api/track-config/calibrations", async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return;
  try {
    const body = request.body ?? {};
    if (typeof body.mapDefinitionId !== "string" || (body.direction !== "forward" && body.direction !== "reverse") || typeof body.startFinishPathPct !== "number")
      return reply.code(400).send({ error: "Map, start/finish position, and direction are required." });
    const calibration = await trackConfiguration.saveCalibration({
      mapDefinitionId: body.mapDefinitionId, startFinishPathPct: body.startFinishPathPct, direction: body.direction,
      rotationDegrees: typeof body.rotationDegrees === "number" ? body.rotationDegrees : undefined, author: admin.username,
    });
    return reply.code(201).send(calibration);
  } catch (error) { return sendConfigurationFailure(reply, error); }
});

app.post<{ Params: { id: string }; Body: { layout?: unknown } }>("/api/track-config/calibrations/:id/activate", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  try {
    const layout = request.body?.layout ? requestedLayout(request.body.layout) : currentLayout();
    if (!layout) return reply.code(404).send({ error: "No active track layout is available." });
    const result = await trackConfiguration.activateCalibration(request.params.id, layout);
    await refreshTrackConfiguration();
    return result;
  } catch (error) { return sendConfigurationFailure(reply, error); }
});

app.get<{ Querystring: { mapDefinitionId?: string } }>("/api/track-config/calibrations", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  if (!request.query.mapDefinitionId) return reply.code(400).send({ error: "mapDefinitionId is required." });
  return trackConfiguration.listCalibrations(request.query.mapDefinitionId);
});

app.get("/api/track-config/sectors", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  const layout = currentLayout();
  if (!layout) return reply.code(404).send({ error: "No active track layout is available." });
  return trackConfiguration.listSectorRevisions(layout);
});

app.post<{ Body: { layout?: unknown; boundaries?: unknown; mapCalibrationId?: unknown } }>("/api/track-config/sectors", async (request, reply) => {
  const admin = await requireAdmin(request, reply); if (!admin) return;
  try {
    const layout = request.body?.layout ? requestedLayout(request.body.layout) : currentLayout();
    if (!layout || !Array.isArray(request.body?.boundaries)) return reply.code(400).send({ error: "Layout and ordered boundaries are required." });
    const boundaries = request.body.boundaries.map((value) => {
      const boundary = value as Record<string, unknown>;
      return { sectorNumber: Number(boundary.sectorNumber), startPct: Number(boundary.startPct) } satisfies SectorBoundary;
    });
    const draft = await trackConfiguration.saveSectorDraft({
      layout, boundaries, mapCalibrationId: typeof request.body.mapCalibrationId === "string" ? request.body.mapCalibrationId : null,
      author: admin.username, sessionId: store.snapshot().session?.id,
    });
    return reply.code(201).send(draft);
  } catch (error) { return sendConfigurationFailure(reply, error); }
});

app.post<{ Params: { revision: string }; Body: { layout?: unknown } }>("/api/track-config/sectors/:revision/activate", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  try {
    const session = store.snapshot().session;
    const layout = request.body?.layout ? requestedLayout(request.body.layout) : currentLayout();
    if (!layout) return reply.code(404).send({ error: "No active track layout is available." });
    const result = await trackConfiguration.activateSectorRevision(request.params.revision, layout, session);
    await refreshTrackConfiguration();
    for (const [socket, role] of sockets) if (role === "telemetry") await sendActiveSectorIfChanged(socket);
    return result;
  } catch (error) { return sendConfigurationFailure(reply, error); }
});
app.get("/api/packages", async (request, reply) => {
  if (!await requireAdmin(request, reply)) return;
  return registry.list();
});

if (existsSync(webRoot)) {
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/") && !request.url.startsWith("/packages/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

async function authorizeSocket(req: IncomingMessage): Promise<boolean> {
  const access = parseSocketAccess(req.url);
  if (!access) return false;
  if (access.role === "control" || access.role === "commentator") {
    return await auth.validateSession(sessionToken(req.headers.cookie)) !== null;
  }
  if (access.role === "telemetry") return auth.validateAccessKey("ingestion", bearerToken(req.headers.authorization));
  if (access.role === "overlay") return auth.validateAccessKey("view", viewToken(req.headers["sec-websocket-protocol"]));
  return false;
}

const wss = new WebSocketServer({
  server: app.server,
  path: "/socket",
  maxPayload: 1_048_576,
  verifyClient: ({ req }: { req: IncomingMessage }, done) => {
    void authorizeSocket(req)
      .then((authorized) => done(authorized, authorized ? undefined : 401, authorized ? undefined : "Unauthorized"))
      .catch((error) => {
        app.log.error(error, "WebSocket authorization failed");
        done(false, 500, "Authorization unavailable");
      });
  },
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function sendActiveSectorIfChanged(socket: WebSocket): Promise<void> {
  const message = await activeSectorMessage();
  const revision = message.payload?.revision ?? null;
  if (sentSectorRevisions.get(socket) === revision) return;
  sentSectorRevisions.set(socket, revision);
  send(socket, message);
}

function broadcast(): void {
  const message: ServerMessage = { type: "state.snapshot", payload: store.snapshot() };
  broadcastStateSnapshot(sockets, message);
}

store.subscribe(broadcast);

wss.on("connection", (socket, request) => {
  const access = parseSocketAccess(request.url);
  if (!access) return socket.close(1008, "Invalid socket access mode.");
  const role: SocketRole = access.role;
  sockets.set(socket, role);
  if (role !== "telemetry") send(socket, { type: "state.snapshot", payload: store.snapshot() });

  socket.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      if (message.type === "hello" && !helloMatchesAccess(message, access)) return socket.close(1008, "Role does not match authenticated connection.");
      if (message.type === "hello" && role === "telemetry") {
        if (message.capabilities?.cameraControl) cameraSockets.add(socket);
        store.setCameraController(true, cameraSockets.size > 0);
        await sendActiveSectorIfChanged(socket);
      }
      if (message.type === "telemetry.update" && role === "telemetry") {
        await trackConfiguration.observeNativeDefinition(message.payload);
        const sequence = acceptTelemetry(message, store, history, intelligence);
        await refreshTrackConfiguration();
        await sendActiveSectorIfChanged(socket);
        if (sequence !== null) send(socket, { type: "telemetry.ack", sequence });
      }
      if (message.type === "lap.history.request" && role !== "telemetry") {
        const session = store.snapshot().session;
        if (!session || !Number.isInteger(message.carIdx)) {
          send(socket, { type: "lap.history", payload: [] });
        } else {
          send(socket, {
            type: "lap.history",
            payload: await history.listLaps(
              session,
              message.carIdx,
              Number.isInteger(message.limit) ? message.limit : undefined,
            ),
          });
        }
      }
      if (message.type === "control.command") {
        if (!canIssueControlCommands(role)) {
          send(socket, { type: "error", message: "Commentator timing access is read-only." });
        } else {
          const cameraCommand = store.command(message.command, await registry.list());
          if (cameraCommand) {
            const payload = JSON.stringify({ type: "camera.command", command: cameraCommand } satisfies ServerMessage);
            for (const cameraSocket of cameraSockets) {
              if (cameraSocket.readyState === WebSocket.OPEN) cameraSocket.send(payload);
            }
          }
        }
      }
      if (message.type === "camera.result" && role === "telemetry") {
        store.cameraResult(message.commandId, message.status, message.message);
      }
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
    }
  });

  socket.on("error", (error) => {
    sockets.delete(socket);
    sentSectorRevisions.delete(socket);
    app.log.warn({ err: error, role }, "WebSocket connection error");
  });
  socket.on("close", () => {
    sockets.delete(socket);
    sentSectorRevisions.delete(socket);
    cameraSockets.delete(socket);
    if (role === "telemetry") {
      const telemetryConnected = [...sockets.values()].some((candidate) => candidate === "telemetry");
      store.setCameraController(telemetryConnected, cameraSockets.size > 0);
    }
  });
});

const stopSimulator = process.env.DISABLE_SIMULATOR ? undefined : startSimulator(store, (session) => {
  void trackConfiguration.observeNativeDefinition(session).then(refreshTrackConfiguration)
    .catch((error) => app.log.error({ err: error }, "Failed to refresh simulated track configuration"));
  history.ingest(session);
  intelligence.ingest(session);
  store.raceIntelligence(intelligence.snapshot());
});

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Control panel: http://localhost:${port}/control`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down");
  stopSimulator?.();
  for (const socket of sockets.keys()) socket.close(1012, "Server restarting");
  await app.close();
  await history.close();
  await trackConfiguration.close();
  await auth.close();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        app.log.error(error, "Shutdown failed");
        process.exit(1);
      });
  });
}
