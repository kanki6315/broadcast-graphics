import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@racecontrol/protocol";
import { AuthStore } from "./auth-store.js";
import { PackageRegistry } from "./package-registry.js";
import { startSimulator } from "./simulator.js";
import { StateStore } from "./state-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const packageRoot = resolve(projectRoot, "graphic-packages");
const webRoot = resolve(projectRoot, "apps/web/dist");
const authDataPath = resolve(projectRoot, "apps/server/data/auth.json");

const app = Fastify({ logger: true });
const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  if (process.env.NODE_ENV === "production") throw new Error("ADMIN_PASSWORD is required in production.");
  adminPassword = randomBytes(18).toString("base64url");
  app.log.warn(`Development admin login — username: ${adminUsername} password: ${adminPassword}`);
}
const auth = new AuthStore(authDataPath, adminUsername, adminPassword);
await auth.initialize();
const registry = new PackageRegistry(packageRoot);
const packages = await registry.list();
const store = new StateStore(packages[0]?.id ?? "apex");
const sockets = new Set<WebSocket>();
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

function requireAdmin(request: { headers: { cookie?: string } }, reply: { code(status: number): { send(body: unknown): unknown } }): { username: string } | null {
  const admin = auth.validateSession(sessionToken(request.headers.cookie));
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
  setSessionCookie(reply, auth.createSession());
  return { username };
});

app.get("/api/auth/me", async (request, reply) => {
  const admin = requireAdmin(request, reply);
  return admin ?? undefined;
});

app.post("/api/auth/logout", async (request, reply) => {
  auth.revokeSession(sessionToken(request.headers.cookie));
  setSessionCookie(reply, "", 0);
  return { ok: true };
});

app.get("/api/auth/keys", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return auth.listKeys();
});

app.post<{ Body: { kind?: unknown; label?: unknown } }>("/api/auth/keys", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const kind = request.body?.kind;
  const label = typeof request.body?.label === "string" ? request.body.label.trim().slice(0, 80) : "";
  if ((kind !== "ingestion" && kind !== "view") || !label) {
    return reply.code(400).send({ error: "Choose a key type and provide a label." });
  }
  return reply.code(201).send(await auth.createKey(kind, label));
});

app.delete<{ Params: { id: string } }>("/api/auth/keys/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  if (!await auth.revokeKey(request.params.id)) return reply.code(404).send({ error: "Active key not found." });
  return { ok: true };
});

app.get("/api/state", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return store.snapshot();
});
app.get("/api/packages", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
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

const wss = new WebSocketServer({
  server: app.server,
  path: "/socket",
  maxPayload: 1_048_576,
  verifyClient: ({ req }: { req: IncomingMessage }) => {
    const url = new URL(req.url ?? "/socket", "http://localhost");
    const role = url.searchParams.get("role");
    if (role === "control") return auth.validateSession(sessionToken(req.headers.cookie)) !== null;
    if (role === "telemetry") return auth.validateAccessKey("ingestion", bearerToken(req.headers.authorization));
    if (role === "overlay") return auth.validateAccessKey("view", viewToken(req.headers["sec-websocket-protocol"]));
    return false;
  },
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(): void {
  const message: ServerMessage = { type: "state.snapshot", payload: store.snapshot() };
  for (const socket of sockets) send(socket, message);
}

store.subscribe(broadcast);

wss.on("connection", (socket, request) => {
  const role = new URL(request.url ?? "/socket", "http://localhost").searchParams.get("role");
  sockets.add(socket);
  send(socket, { type: "state.snapshot", payload: store.snapshot() });

  socket.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      if (message.type === "hello" && message.role !== role) return socket.close(1008, "Role does not match authenticated connection.");
      if (message.type === "telemetry.update" && role === "telemetry") store.telemetry(message.payload);
      if (message.type === "control.command" && role === "control") store.command(message.command, await registry.list());
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message" });
    }
  });

  socket.on("close", () => sockets.delete(socket));
});

if (!process.env.DISABLE_SIMULATOR) startSimulator(store);

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`Control panel: http://localhost:${port}/control`);
