import { randomUUID } from "node:crypto";
import type {
  CameraSwitchCommand,
  ControlCommand,
  EventRecord,
  GraphicPackageManifest,
  LiveState,
  RaceIntelligenceSnapshot,
  SessionState,
  TrackConfigurationSnapshot,
} from "@racecontrol/protocol";
import { RaceStateProjection } from "./race-state-projection.js";
import type { RaceStateCheckpoint } from "./race-state-projection.js";

type Listener = (state: LiveState) => void;

export class StateStore {
  private state: LiveState;
  private readonly listeners = new Set<Listener>();
  private readonly raceState = new RaceStateProjection();
  private staleTimer: NodeJS.Timeout | null = null;

  constructor(defaultPackageId = "pri-hoosier-500") {
    this.state = {
      revision: 0,
      connection: "disconnected",
      session: null,
      sessionResults: {},
      graphics: {
        packageId: defaultPackageId,
        activeSlots: [],
        armedSlot: "timing-tower",
        selectedDriverCarIdx: null,
        slotConfig: {},
      },
      camera: {
        controller: "disconnected",
        groups: [],
        selectedGroup: null,
        activeCarIdx: null,
        activeGroup: null,
        activeCamera: null,
        pendingCommandId: null,
        lastResult: null,
        lastMessage: null,
      },
      events: [this.event("system", "Server ready — waiting for telemetry")],
      intelligence: null,
      trackConfiguration: null,
    };
  }

  snapshot(): LiveState {
    return structuredClone(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  raceStateCheckpoint(): RaceStateCheckpoint | null {
    return this.raceState.checkpoint();
  }

  restoreRaceState(checkpoint: RaceStateCheckpoint): void {
    this.raceState.restore(checkpoint);
  }

  telemetry(session: SessionState): void {
    const wasDisconnected = this.state.connection !== "connected";
    session = this.raceState.apply(session);
    this.state.session = session;
    this.state.sessionResults[session.type] = session;
    this.state.connection = "connected";
    this.state.camera.groups = session.cameraGroups ?? [];
    this.state.camera.activeCarIdx = session.activeCameraCarIdx ?? null;
    this.state.camera.activeGroup = session.activeCameraGroup ?? null;
    this.state.camera.activeCamera = session.activeCamera ?? null;
    if (!this.state.camera.groups.some((group) => group.number === this.state.camera.selectedGroup)) {
      this.state.camera.selectedGroup = this.state.camera.groups.find((group) => !group.isScenic && group.cameras.length > 0)?.number
        ?? this.state.camera.groups.find((group) => group.cameras.length > 0)?.number
        ?? null;
    }

    if (this.state.graphics.selectedDriverCarIdx == null && session.drivers.length > 0) {
      this.state.graphics.selectedDriverCarIdx = session.drivers[0].carIdx;
    }

    if (wasDisconnected) this.pushEvent("telemetry", `Telemetry connected — ${session.trackName}`);
    this.bump();
    this.armStaleTimer();
  }

  raceIntelligence(snapshot: RaceIntelligenceSnapshot | null): void {
    this.state.intelligence = snapshot;
  }

  trackConfiguration(snapshot: TrackConfigurationSnapshot | null): void {
    const changed = JSON.stringify(this.state.trackConfiguration) !== JSON.stringify(snapshot);
    this.state.trackConfiguration = structuredClone(snapshot);
    if (changed) this.bump();
  }

  command(command: ControlCommand, packages: GraphicPackageManifest[]): CameraSwitchCommand | null {
    let cameraCommand: CameraSwitchCommand | null = null;
    switch (command.type) {
      case "focus.set": {
        const driver = this.state.session?.drivers.find((candidate) => candidate.carIdx === command.carIdx);
        if (!driver) throw new Error("That driver is not present in the current session.");
        this.state.graphics.selectedDriverCarIdx = command.carIdx;
        this.pushEvent("operator", `Focus set — #${driver.carNumber} ${driver.name}`);
        cameraCommand = this.createCameraCommand(driver.carIdx, driver.carNumber);
        break;
      }
      case "camera.group.set": {
        const group = this.state.camera.groups.find((candidate) => candidate.number === command.cameraGroup && candidate.cameras.length > 0);
        if (!group) throw new Error("That camera group is not available in the current iRacing session.");
        this.state.camera.selectedGroup = group.number;
        this.state.camera.lastResult = null;
        this.state.camera.lastMessage = `${group.name} armed`;
        this.pushEvent("operator", `Camera group armed — ${group.name}`);
        break;
      }
      case "camera.group.take": {
        const group = this.state.camera.groups.find((candidate) => candidate.number === command.cameraGroup && candidate.cameras.length > 0);
        if (!group) throw new Error("That camera group is not available in the current iRacing session.");
        const driver = this.state.session?.drivers.find((candidate) => candidate.carIdx === this.state.graphics.selectedDriverCarIdx);
        if (!driver) throw new Error("Select a driver before taking the camera.");
        this.state.camera.selectedGroup = group.number;
        this.pushEvent("operator", `Camera group selected — ${group.name}`);
        cameraCommand = this.createCameraCommand(driver.carIdx, driver.carNumber);
        break;
      }
      case "camera.driver.take": {
        const group = this.state.camera.groups.find((candidate) => candidate.number === command.cameraGroup && candidate.cameras.length > 0);
        if (!group) throw new Error("That camera group is not available in the current iRacing session.");
        const driver = this.state.session?.drivers.find((candidate) => candidate.carIdx === command.carIdx);
        if (!driver) throw new Error("That driver is not present in the current session.");
        if (this.state.camera.controller !== "ready") {
          cameraCommand = this.createCameraCommand(driver.carIdx, driver.carNumber);
          break;
        }
        this.state.graphics.selectedDriverCarIdx = driver.carIdx;
        this.state.camera.selectedGroup = group.number;
        this.pushEvent("operator", `Camera selected — #${driver.carNumber} ${driver.name} / ${group.name}`);
        cameraCommand = this.createCameraCommand(driver.carIdx, driver.carNumber);
        break;
      }
      case "camera.take": {
        const driver = this.state.session?.drivers.find((candidate) => candidate.carIdx === this.state.graphics.selectedDriverCarIdx);
        if (!driver) throw new Error("Select a driver before taking the camera.");
        cameraCommand = this.createCameraCommand(driver.carIdx, driver.carNumber);
        break;
      }
      case "graphics.arm":
        this.state.graphics.armedSlot = command.slot;
        this.pushEvent("operator", `${this.label(command.slot)} selected`);
        break;
      case "graphics.take":
        if (!this.state.graphics.activeSlots.includes(command.slot)) {
          this.state.graphics.activeSlots = [...this.state.graphics.activeSlots, command.slot];
        }
        this.state.graphics.armedSlot = command.slot;
        this.pushEvent("operator", `${this.label(command.slot)} taken on air`);
        break;
      case "graphics.clear":
        this.state.graphics.activeSlots = this.state.graphics.activeSlots.filter((slot) => slot !== command.slot);
        this.pushEvent("operator", `${this.label(command.slot)} cleared`);
        break;
      case "graphics.clearAll":
        this.state.graphics.activeSlots = [];
        this.pushEvent("operator", "All graphics cleared");
        break;
      case "graphics.package.set":
        if (!packages.some((candidate) => candidate.id === command.packageId)) {
          throw new Error("That graphic package is not installed.");
        }
        this.state.graphics.packageId = command.packageId;
        this.pushEvent("operator", `Client package changed — ${command.packageId}`);
        break;
      case "graphics.config.set":
        this.state.graphics.slotConfig[command.slot] = {
          ...this.state.graphics.slotConfig[command.slot],
          [command.key]: command.value,
        };
        this.pushEvent("operator", `${this.label(command.slot)} configuration updated`);
        break;
    }
    this.bump();
    return cameraCommand;
  }

  setCameraController(connected: boolean, available: boolean): void {
    const controller = !connected ? "disconnected" : available ? "ready" : "unavailable";
    if (this.state.camera.controller === controller) return;
    this.state.camera.controller = controller;
    if (controller !== "ready") {
      this.state.camera.pendingCommandId = null;
      this.state.camera.lastResult = null;
      this.state.camera.lastMessage = controller === "unavailable" ? "Live iRacing camera control is unavailable for this source" : "Telemetry client disconnected";
    }
    this.pushEvent("system", controller === "ready" ? "iRacing camera controller ready" : this.state.camera.lastMessage!);
    this.bump();
  }

  cameraResult(commandId: string, status: "sent" | "rejected", message: string): void {
    if (this.state.camera.pendingCommandId !== commandId) return;
    this.state.camera.pendingCommandId = null;
    this.state.camera.lastResult = status;
    this.state.camera.lastMessage = message;
    this.pushEvent(status === "sent" ? "operator" : "system", message);
    this.bump();
  }

  private createCameraCommand(carIdx: number, carNumber: string): CameraSwitchCommand | null {
    if (this.state.camera.controller !== "ready") {
      this.state.camera.lastResult = "rejected";
      this.state.camera.lastMessage = "Camera not sent — live iRacing controller is not ready";
      return null;
    }
    const group = this.state.camera.groups.find((candidate) => candidate.number === this.state.camera.selectedGroup);
    const camera = group?.cameras[0];
    if (!group || !camera) {
      this.state.camera.lastResult = "rejected";
      this.state.camera.lastMessage = "Camera not sent — choose an available camera group";
      return null;
    }
    const command = { id: randomUUID(), carIdx, carNumber, cameraGroup: group.number, camera: camera.number };
    this.state.camera.pendingCommandId = command.id;
    this.state.camera.lastResult = null;
    this.state.camera.lastMessage = `Sending #${carNumber} to ${group.name}`;
    return command;
  }

  private label(slot: string): string {
    return slot.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  }

  private event(kind: EventRecord["kind"], message: string): EventRecord {
    return { id: randomUUID(), at: new Date().toISOString(), kind, message };
  }

  private pushEvent(kind: EventRecord["kind"], message: string): void {
    this.state.events = [this.event(kind, message), ...this.state.events].slice(0, 40);
  }

  private bump(): void {
    this.state.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private armStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      this.state.connection = "stale";
      this.pushEvent("system", "Telemetry is stale — checking the client connection");
      this.bump();
    }, 5_000);
  }
}
