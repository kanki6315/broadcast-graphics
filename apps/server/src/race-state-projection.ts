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
    const classified = session.drivers.filter((driver) => driver.position > 0);
    const trustworthyStart = session.phase === "racing"
      && classified.length > 0
      && classified.every((driver) => driver.lapsCompleted === 0 && driver.currentLap <= 1);

    return {
      ...session,
      drivers: session.drivers.map((driver) => this.projectDriver(driver, trustworthyStart)),
    };
  }

  private projectDriver(driver: DriverState, trustworthyStart: boolean): DriverState {
    let baseline = this.baselines.get(driver.carIdx);
    if (!baseline) {
      baseline = {
        overall: Object.hasOwn(driver, "startingPosition")
          ? driver.startingPosition ?? null
          : trustworthyStart && driver.position > 0 ? driver.position : null,
        class: Object.hasOwn(driver, "startingClassPosition")
          ? driver.startingClassPosition ?? null
          : trustworthyStart && driver.classPosition > 0 ? driver.classPosition : null,
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
