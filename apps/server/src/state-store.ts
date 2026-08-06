import { randomUUID } from "node:crypto";
import type {
  ControlCommand,
  EventRecord,
  GraphicPackageManifest,
  LiveState,
  SessionState,
} from "@racecontrol/protocol";

type Listener = (state: LiveState) => void;

export class StateStore {
  private state: LiveState;
  private readonly listeners = new Set<Listener>();
  private staleTimer: NodeJS.Timeout | null = null;

  constructor(defaultPackageId = "apex") {
    this.state = {
      revision: 0,
      connection: "disconnected",
      session: null,
      graphics: {
        packageId: defaultPackageId,
        activeSlots: [],
        armedSlot: "timing-tower",
        selectedDriverCarIdx: null,
        slotConfig: {},
      },
      events: [this.event("system", "Server ready — waiting for telemetry")],
    };
  }

  snapshot(): LiveState {
    return structuredClone(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  telemetry(session: SessionState): void {
    const wasDisconnected = this.state.connection !== "connected";
    this.state.session = session;
    this.state.connection = "connected";

    if (this.state.graphics.selectedDriverCarIdx == null && session.drivers.length > 0) {
      this.state.graphics.selectedDriverCarIdx = session.drivers[0].carIdx;
    }

    if (wasDisconnected) this.pushEvent("telemetry", `Telemetry connected — ${session.trackName}`);
    this.bump();
    this.armStaleTimer();
  }

  command(command: ControlCommand, packages: GraphicPackageManifest[]): void {
    switch (command.type) {
      case "focus.set": {
        const driver = this.state.session?.drivers.find((candidate) => candidate.carIdx === command.carIdx);
        if (!driver) throw new Error("That driver is not present in the current session.");
        this.state.graphics.selectedDriverCarIdx = command.carIdx;
        this.pushEvent("operator", `Focus set — #${driver.carNumber} ${driver.name}`);
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
