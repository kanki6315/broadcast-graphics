import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@racecontrol/protocol";
import { createAuthenticationStore } from "./auth-store.js";
import { PackageRegistry } from "./package-registry.js";
import { createRaceHistoryRepository, RaceHistoryService } from "./race-history-store.js";
import { startSimulator } from "./simulator.js";
import { broadcastStateSnapshot, type SocketRole } from "./socket-broadcast.js";
import { StateStore } from "./state-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const packageRoot = resolve(projectRoot, "graphic-packages");
const webRoot = resolve(projectRoot, "apps/web/dist");
const authDataPath = process.env.AUTH_DATA_PATH ?? resolve(projectRoot, "apps/server/data/auth.json");

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
const registry = new PackageRegistry(packageRoot);
const packages = await registry.list();
const store = new StateStore(packages[0]?.id ?? "apex");
const sockets = new Map<WebSocket, SocketRole>();
const cameraSockets = new Set<WebSocket>();
const history = new RaceHistoryService(
  historyRepository,
  (lap) => broadcastStateSnapshot(sockets, { type: "lap.completed", payload: lap }),
  (error) => app.log.error({ err: error }, "Failed to persist completed lap"),
);
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
  const url = new URL(req.url ?? "/socket", "http://localhost");
  const role = url.searchParams.get("role");
  if (role === "control") return await auth.validateSession(sessionToken(req.headers.cookie)) !== null;
  if (role === "telemetry") return auth.validateAccessKey("ingestion", bearerToken(req.headers.authorization));
  if (role === "overlay") return auth.validateAccessKey("view", viewToken(req.headers["sec-websocket-protocol"]));
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

function broadcast(): void {
  const message: ServerMessage = { type: "state.snapshot", payload: store.snapshot() };
  broadcastStateSnapshot(sockets, message);
}

store.subscribe(broadcast);

wss.on("connection", (socket, request) => {
  const role = new URL(request.url ?? "/socket", "http://localhost").searchParams.get("role") as SocketRole;
  sockets.set(socket, role);
  if (role !== "telemetry") send(socket, { type: "state.snapshot", payload: store.snapshot() });

  socket.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      if (message.type === "hello" && message.role !== role) return socket.close(1008, "Role does not match authenticated connection.");
      if (message.type === "hello" && role === "telemetry") {
        if (message.capabilities?.cameraControl) cameraSockets.add(socket);
        store.setCameraController(true, cameraSockets.size > 0);
      }
      if (message.type === "telemetry.update" && role === "telemetry") {
        store.telemetry(message.payload);
        history.ingest(message.payload);
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
      if (message.type === "control.command" && role === "control") {
        const cameraCommand = store.command(message.command, await registry.list());
        if (cameraCommand) {
          const payload = JSON.stringify({ type: "camera.command", command: cameraCommand } satisfies ServerMessage);
          for (const cameraSocket of cameraSockets) {
            if (cameraSocket.readyState === WebSocket.OPEN) cameraSocket.send(payload);
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
    app.log.warn({ err: error, role }, "WebSocket connection error");
  });
  socket.on("close", () => {
    sockets.delete(socket);
    cameraSockets.delete(socket);
    if (role === "telemetry") {
      const telemetryConnected = [...sockets.values()].some((candidate) => candidate === "telemetry");
      store.setCameraController(telemetryConnected, cameraSockets.size > 0);
    }
  });
});

const stopSimulator = process.env.DISABLE_SIMULATOR ? undefined : startSimulator(store, (session) => history.ingest(session));

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
