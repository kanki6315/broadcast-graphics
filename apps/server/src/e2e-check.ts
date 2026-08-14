import assert from "node:assert/strict";
import { WebSocket } from "ws";
import type { LiveState, ServerMessage } from "@racecontrol/protocol";

const baseUrl = process.env.E2E_URL ?? "http://127.0.0.1:8787";
const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("E2E_ADMIN_PASSWORD is required.");
const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json()) as { ok: boolean };
if (!health.ok) throw new Error("Health endpoint did not report ready.");
const clientReleaseResponse = await fetch(`${baseUrl}/api/client/latest`);
if (process.env.E2E_REQUIRE_CLIENT_RELEASE === "1" && !clientReleaseResponse.ok)
  throw new Error(`Client release endpoint failed with status ${clientReleaseResponse.status}.`);
const clientRelease = clientReleaseResponse.ok
  ? await clientReleaseResponse.json() as { version?: string; url?: string; sha256?: string; size?: number }
  : null;
if (clientRelease && (!clientRelease.version || clientRelease.url !== "/api/client/download" || !clientRelease.sha256 || !clientRelease.size))
  throw new Error("Client release endpoint returned an invalid manifest.");

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: adminUsername, password: adminPassword }),
});
if (!login.ok) throw new Error(`Admin login failed with status ${login.status}.`);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("Admin login did not return a session cookie.");

const keyResponse = await fetch(`${baseUrl}/api/auth/keys`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ kind: "ingestion", label: "Integration session" }),
});
if (!keyResponse.ok) throw new Error(`Integration ingestion key creation failed with status ${keyResponse.status}.`);
const createdKey = await keyResponse.json() as { key: { id: string }; secret: string };

interface SocketHarness {
  socket: WebSocket;
  messages: ServerMessage[];
}

async function connectSocket(path: string, headers: Record<string, string>): Promise<SocketHarness> {
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + path, { headers });
  const messages: ServerMessage[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, messages };
}

async function waitForMessage<T extends ServerMessage>(
  harness: SocketHarness,
  predicate: (message: ServerMessage) => message is T,
  timeoutMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = harness.messages.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for integration socket condition.");
}

const telemetry = await connectSocket("/socket?role=telemetry", { Authorization: `Bearer ${createdKey.secret}` });
telemetry.socket.send(JSON.stringify({ type: "hello", role: "telemetry", clientId: "integration", capabilities: { cameraControl: true } }));
const operator = await connectSocket("/socket?role=control&mode=operator", { Cookie: cookie });
operator.socket.send(JSON.stringify({ type: "hello", role: "control", mode: "operator" }));
const commentator = await connectSocket("/socket?role=control&mode=commentator", { Cookie: cookie });
commentator.socket.send(JSON.stringify({ type: "hello", role: "control", mode: "commentator" }));

const initialMessage = await waitForMessage(operator, (message): message is Extract<ServerMessage, { type: "state.snapshot" }> =>
  message.type === "state.snapshot" && message.payload.session != null && message.payload.camera.controller === "ready");
const initial = initialMessage.payload;
const target = initial.session!.drivers[2]!;
const cameraGroup = initial.session!.cameraGroups?.find((group) => !group.isScenic && group.cameras.length > 0);
assert.ok(cameraGroup, "Simulator fixture must expose an operable camera group.");
const initialFocus = initial.graphics.selectedDriverCarIdx;

commentator.socket.send(JSON.stringify({
  type: "control.command",
  command: { type: "camera.driver.take", carIdx: target.carIdx, cameraGroup: cameraGroup.number },
}));
const readOnlyError = await waitForMessage(commentator, (message): message is Extract<ServerMessage, { type: "error" }> =>
  message.type === "error" && message.message === "Commentator timing access is read-only.");
assert.equal(readOnlyError.message, "Commentator timing access is read-only.");
await new Promise((resolve) => setTimeout(resolve, 100));
const stateAfterCommentator = await fetch(`${baseUrl}/api/state`, { headers: { Cookie: cookie } }).then((response) => response.json()) as LiveState;
assert.equal(stateAfterCommentator.graphics.selectedDriverCarIdx, initialFocus);
assert.equal(telemetry.messages.some((message) => message.type === "camera.command"), false);

operator.socket.send(JSON.stringify({
  type: "control.command",
  command: { type: "camera.driver.take", carIdx: target.carIdx, cameraGroup: cameraGroup.number },
}));
const cameraMessage = await waitForMessage(telemetry, (message): message is Extract<ServerMessage, { type: "camera.command" }> =>
  message.type === "camera.command" && message.command.carIdx === target.carIdx);
assert.equal(cameraMessage.command.cameraGroup, cameraGroup.number);
await waitForMessage(operator, (message): message is Extract<ServerMessage, { type: "state.snapshot" }> =>
  message.type === "state.snapshot"
  && message.payload.graphics.selectedDriverCarIdx === target.carIdx
  && message.payload.camera.pendingCommandId === cameraMessage.command.id);
telemetry.socket.send(JSON.stringify({ type: "camera.result", commandId: cameraMessage.command.id, status: "sent", message: "Integration camera delivered" }));
const cameraDelivered = await waitForMessage(operator, (message): message is Extract<ServerMessage, { type: "state.snapshot" }> =>
  message.type === "state.snapshot"
  && message.payload.camera.lastResult === "sent"
  && message.payload.camera.pendingCommandId === null);

const trackerVisit = {
  pitEntryTime: 100, pitExitTime: 128, pitLaneTime: 9, boxTime: 19, unknownTime: 0,
  observedBoxTime: 9, inferredBoxTime: 10, driverChange: true,
  entryDriverId: "41", exitDriverId: "42", quality: "contains-inference" as const,
};
const unknownVisit = {
  pitEntryTime: 200, pitExitTime: 210, pitLaneTime: 0, boxTime: 0, unknownTime: 10,
  observedBoxTime: 0, inferredBoxTime: 0, driverChange: false,
  entryDriverId: "43", exitDriverId: "43", quality: "incomplete" as const,
};
const integrationSession = {
  ...initial.session!,
  id: "integration-pit-projection",
  timestamp: new Date().toISOString(),
  drivers: [
    { ...initial.session!.drivers[0]!, pitState: "not-in-pits" as const, latestPitVisit: trackerVisit },
    { ...initial.session!.drivers[1]!, pitState: "not-in-pits" as const, latestPitVisit: unknownVisit },
  ],
  classes: initial.session!.classes.map((carClass) => ({
    ...carClass,
    carCount: [initial.session!.drivers[0]!, initial.session!.drivers[1]!].filter((driver) => driver.classId === carClass.id).length,
  })),
};
telemetry.socket.send(JSON.stringify({ type: "telemetry.update", sequence: 91, payload: integrationSession }));
await waitForMessage(telemetry, (message): message is Extract<ServerMessage, { type: "telemetry.ack" }> =>
  message.type === "telemetry.ack" && message.sequence === 91);
const projected = await waitForMessage(operator, (message): message is Extract<ServerMessage, { type: "state.snapshot" }> =>
  message.type === "state.snapshot" && message.payload.session?.id === integrationSession.id);
const projectedInferred = projected.payload.session!.drivers.find((driver) => driver.carIdx === integrationSession.drivers[0]!.carIdx)!;
const projectedUnknown = projected.payload.session!.drivers.find((driver) => driver.carIdx === integrationSession.drivers[1]!.carIdx)!;
assert.deepEqual(projectedInferred.latestPitVisit, trackerVisit);
assert.equal(projectedInferred.latestPitVisit!.boxTime, projectedInferred.latestPitVisit!.observedBoxTime + projectedInferred.latestPitVisit!.inferredBoxTime);
assert.deepEqual(projectedUnknown.latestPitVisit, unknownVisit);

console.log(JSON.stringify({
  health: "ok",
  windowsClientVersion: clientRelease?.version ?? "release package not configured",
  commentatorReadOnly: "verified",
  cameraControl: cameraDelivered.payload.camera.lastMessage,
  focusedDriver: target.name,
  pitTrackerProjection: projectedInferred.latestPitVisit,
  unknownPitProjection: projectedUnknown.latestPitVisit,
  revision: projected.payload.revision,
}, null, 2));

for (const harness of [commentator, operator, telemetry]) harness.socket.close();
await fetch(`${baseUrl}/api/auth/keys/${createdKey.key.id}`, { method: "DELETE", headers: { Cookie: cookie } });
