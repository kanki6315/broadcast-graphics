import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@racecontrol/protocol";
import { PackageRegistry } from "./package-registry.js";
import { startSimulator } from "./simulator.js";
import { StateStore } from "./state-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../../..");
const packageRoot = resolve(projectRoot, "graphic-packages");
const webRoot = resolve(projectRoot, "apps/web/dist");

const app = Fastify({ logger: true });
const registry = new PackageRegistry(packageRoot);
const packages = await registry.list();
const store = new StateStore(packages[0]?.id ?? "apex");
const sockets = new Set<WebSocket>();

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
app.get("/api/state", async () => store.snapshot());
app.get("/api/packages", async () => registry.list());

if (existsSync(webRoot)) {
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/") && !request.url.startsWith("/packages/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

const wss = new WebSocketServer({ server: app.server, path: "/socket" });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(): void {
  const message: ServerMessage = { type: "state.snapshot", payload: store.snapshot() };
  for (const socket of sockets) send(socket, message);
}

store.subscribe(broadcast);

wss.on("connection", (socket) => {
  sockets.add(socket);
  send(socket, { type: "state.snapshot", payload: store.snapshot() });

  socket.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      if (message.type === "telemetry.update") store.telemetry(message.payload);
      if (message.type === "control.command") store.command(message.command, await registry.list());
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
