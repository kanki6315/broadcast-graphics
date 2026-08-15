import type { DriverState, SessionState } from "@racecontrol/protocol";

interface PositionBaseline {
  overall: number | null;
  class: number | null;
}

export interface RaceStateCheckpoint {
  sessionId: string;
  baselines: Array<[number, PositionBaseline]>;
}

export class RaceStateProjection {
  private sessionId: string | null = null;
  private readonly baselines = new Map<number, PositionBaseline>();

  checkpoint(): RaceStateCheckpoint | null {
    return this.sessionId ? structuredClone({ sessionId: this.sessionId, baselines: [...this.baselines] }) : null;
  }

  restore(checkpoint: RaceStateCheckpoint): void {
    this.sessionId = checkpoint.sessionId;
    this.baselines.clear();
    for (const [carIdx, baseline] of checkpoint.baselines) this.baselines.set(carIdx, structuredClone(baseline));
  }

  apply(session: SessionState): SessionState {
    if (this.sessionId !== session.id) {
      this.sessionId = session.id;
      this.baselines.clear();
    }

    if (session.type !== "race") return session;
    const isPreRace = ["get-in-car", "warmup", "parade-laps"].includes(session.phase);

    return {
      ...session,
      drivers: session.drivers.map((driver) => this.projectDriver(driver, isPreRace)),
    };
  }

  private projectDriver(driver: DriverState, isPreRace: boolean): DriverState {
    let baseline = this.baselines.get(driver.carIdx);
    if (isPreRace && driver.position > 0) {
      baseline = {
        overall: driver.position,
        class: driver.classPosition > 0 ? driver.classPosition : null,
      };
      this.baselines.set(driver.carIdx, baseline);
    }
    if (!baseline) {
      baseline = {
        overall: driver.startingPosition ?? null,
        class: driver.startingClassPosition ?? null,
      };
      this.baselines.set(driver.carIdx, baseline);
    }

    return {
      ...driver,
      startingPosition: baseline.overall,
      startingClassPosition: baseline.class,
      positionChange: baseline.overall != null && driver.position > 0 ? baseline.overall - driver.position : null,
      classPositionChange: baseline.class != null && driver.classPosition > 0
        ? baseline.class - driver.classPosition
        : null,
    };
  }
}
