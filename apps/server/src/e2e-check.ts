import { WebSocket } from "ws";
import type { LiveState, ServerMessage } from "@racecontrol/protocol";

const baseUrl = process.env.E2E_URL ?? "http://127.0.0.1:8787";
const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("E2E_ADMIN_PASSWORD is required.");
const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json()) as { ok: boolean };
if (!health.ok) throw new Error("Health endpoint did not report ready.");
const clientReleaseResponse = await fetch(`${baseUrl}/api/client/latest`);
if (!clientReleaseResponse.ok) throw new Error(`Client release endpoint failed with status ${clientReleaseResponse.status}.`);
const clientRelease = await clientReleaseResponse.json() as { version?: string; url?: string; sha256?: string; size?: number };
if (!clientRelease.version || clientRelease.url !== "/api/client/download" || !clientRelease.sha256 || !clientRelease.size)
  throw new Error("Client release endpoint returned an invalid manifest.");

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: adminUsername, password: adminPassword }),
});
if (!login.ok) throw new Error(`Admin login failed with status ${login.status}.`);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Admin login did not return a session cookie.");

const socketUrl = baseUrl.replace(/^http/, "ws") + "/socket?role=control";
const socket = new WebSocket(socketUrl, { headers: { Cookie: cookie } });
let latest: LiveState | null = null;

const waitFor = (predicate: (state: LiveState) => boolean, timeoutMs = 4_000) => new Promise<LiveState>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for live-state condition.")), timeoutMs);
  const inspect = (data: WebSocket.RawData) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    if (message.type !== "state.snapshot") return;
    latest = message.payload;
    if (predicate(message.payload)) {
      clearTimeout(timeout);
      socket.off("message", inspect);
      resolve(message.payload);
    }
  };
  socket.on("message", inspect);
});

await new Promise<void>((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

const initial = await waitFor((state) => state.session != null);
const target = initial.session!.drivers[2];
socket.send(JSON.stringify({ type: "control.command", command: { type: "focus.set", carIdx: target.carIdx } }));
await waitFor((state) => state.graphics.selectedDriverCarIdx === target.carIdx);
socket.send(JSON.stringify({ type: "control.command", command: { type: "graphics.take", slot: "timing-tower" } }));
const taken = await waitFor((state) => state.graphics.activeSlots.includes("timing-tower"));

console.log(JSON.stringify({
  health: "ok",
  windowsClientVersion: clientRelease.version,
  track: taken.session?.trackName,
  focusedDriver: target.name,
  timingTower: "on-air",
  packageId: taken.graphics.packageId,
  revision: taken.revision,
}, null, 2));

socket.close();
