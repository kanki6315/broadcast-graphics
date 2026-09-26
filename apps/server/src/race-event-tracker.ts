import type { DriverState, RaceEvent, SessionState } from "@racecontrol/protocol";

const passCooldownMs = 15_000;
const crashCooldownMs = 20_000;
const maximumPassDistance = 0.06;

function isRunning(driver: DriverState): boolean {
  return driver.isConnected
    && driver.trackStatus === "running"
    && !driver.onPitRoad
    && (driver.pitState == null || driver.pitState === "not-in-pits");
}

function validLapProgress(driver: DriverState): number | null {
  const quality = driver.timingQuality?.lapDistPct?.quality;
  if (driver.lapDistPct == null || !Number.isFinite(driver.lapDistPct) || quality === "invalid" || quality === "incomplete") return null;
  return driver.lapsCompleted + driver.lapDistPct;
}

function nearbyOnTrack(left: DriverState, right: DriverState): boolean {
  const leftProgress = validLapProgress(left);
  const rightProgress = validLapProgress(right);
  return leftProgress != null && rightProgress != null && Math.abs(leftProgress - rightProgress) <= maximumPassDistance;
}

function eventTime(session: SessionState): number {
  const parsed = Date.parse(session.timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export class RaceEventTracker {
  private sessionId: string | null = null;
  private previous: SessionState | null = null;
  private events: RaceEvent[] = [];
  private sequence = 0;
  private readonly lastEmittedAt = new Map<string, number>();

  update(session: SessionState): RaceEvent[] {
    if (session.id !== this.sessionId || (this.previous && (session.sourceMode !== this.previous.sourceMode || (session.timeElapsed ?? 0) < (this.previous.timeElapsed ?? 0)))) {
      this.sessionId = session.id;
      this.previous = structuredClone(session);
      this.events = [];
      this.sequence = 0;
      this.lastEmittedAt.clear();
      return [];
    }

    const previous = this.previous;
    this.previous = structuredClone(session);
    if (!previous || !this.canDetect(previous, session)) return structuredClone(this.events.slice(-30).reverse());

    const detected = [
      ...this.detectCrashes(previous, session),
      ...this.detectPasses(previous, session),
    ];
    if (detected.length > 0) this.events.push(...detected);
    return structuredClone(this.events.slice(-30).reverse());
  }

  history(classId?: number, before?: string, limit = 50) {
    const matching = this.events.filter((event) => classId == null || event.classId === classId);
    const cursor = before == null ? matching.length : matching.findIndex((event) => event.id === before);
    const end = cursor < 0 ? 0 : cursor;
    const events = matching.slice(Math.max(0, end - limit), end).reverse();
    return structuredClone({
      sessionId: this.sessionId,
      events,
      total: matching.length,
      nextBefore: end > limit ? events.at(-1)?.id ?? null : null,
    });
  }

  private canDetect(previous: SessionState, current: SessionState): boolean {
    return previous.type === "race"
      && current.type === "race"
      && previous.phase === "racing"
      && current.phase === "racing"
      && eventTime(current) > eventTime(previous)
      && eventTime(current) - eventTime(previous) <= 5_000
      && (previous.flag === "green" || previous.flag === "white")
      && (current.flag === "green" || current.flag === "white");
  }

  private detectPasses(previous: SessionState, current: SessionState): RaceEvent[] {
    const before = new Map(previous.drivers.map((driver) => [driver.carIdx, driver]));
    const now = new Map(current.drivers.map((driver) => [driver.carIdx, driver]));
    const detected: RaceEvent[] = [];

    for (const overtaker of current.drivers) {
      const previousOvertaker = before.get(overtaker.carIdx);
      if (!previousOvertaker || !isRunning(previousOvertaker) || !isRunning(overtaker)) continue;
      if (previousOvertaker.classPosition <= 0 || overtaker.classPosition <= 0 || overtaker.classPosition >= previousOvertaker.classPosition) continue;

      for (const passed of current.drivers) {
        if (passed.carIdx === overtaker.carIdx || passed.classId !== overtaker.classId) continue;
        const previousPassed = before.get(passed.carIdx);
        if (!previousPassed || !isRunning(previousPassed) || !isRunning(passed)) continue;
        const wasAdjacent = previousOvertaker.classPosition === previousPassed.classPosition + 1;
        const isAdjacent = overtaker.classPosition + 1 === passed.classPosition;
        const swapped = previousOvertaker.classPosition > previousPassed.classPosition && overtaker.classPosition < passed.classPosition;
        if (!wasAdjacent || !isAdjacent || !swapped || !nearbyOnTrack(overtaker, passed)) continue;

        const key = `pass:${Math.min(overtaker.carIdx, passed.carIdx)}:${Math.max(overtaker.carIdx, passed.carIdx)}`;
        if (!this.claim(key, eventTime(current), passCooldownMs)) continue;
        detected.push(this.create(current, {
          kind: "pass",
          confidence: "likely",
          primaryCarIdx: overtaker.carIdx,
          secondaryCarIdx: passed.carIdx,
          classId: overtaker.classId,
          summary: `#${overtaker.carNumber} passed #${passed.carNumber}`,
          detail: `${overtaker.name} moved into ${this.ordinal(overtaker.classPosition)} in ${overtaker.className}`,
        }));
      }
    }
    return detected;
  }

  private detectCrashes(previous: SessionState, current: SessionState): RaceEvent[] {
    const before = new Map(previous.drivers.map((driver) => [driver.carIdx, driver]));
    const detected: RaceEvent[] = [];
    for (const driver of current.drivers) {
      const prior = before.get(driver.carIdx);
      if (!prior || !isRunning(prior) || driver.onPitRoad || driver.pitState === "pit-lane" || driver.pitState === "pit-stall") continue;
      const incidentDelta = Math.max(0, driver.incidents - prior.incidents);
      const positionLoss = prior.classPosition > 0 && driver.classPosition > 0 ? driver.classPosition - prior.classPosition : 0;
      const leftRacingSurface = driver.trackStatus === "off-track" || driver.trackStatus === "not-in-world" || driver.trackStatus === "retired";
      const priorProgress = validLapProgress(prior);
      const currentProgress = validLapProgress(driver);
      const progressDelta = priorProgress != null && currentProgress != null ? currentProgress - priorProgress : null;
      const nearlyStopped = progressDelta != null && progressDelta >= -0.01 && progressDelta <= 0.003 * ((eventTime(current) - eventTime(previous)) / 1000);
      if (positionLoss < 2 || (!leftRacingSurface && !nearlyStopped)) continue;

      const now = eventTime(current);
      if (!this.claim(`crash:${driver.carIdx}`, now, crashCooldownMs)) continue;
      const evidence = [
        incidentDelta > 0 ? `+${incidentDelta} incident points` : null,
        driver.trackStatus === "off-track" ? "off track" : null,
        driver.trackStatus === "not-in-world" ? "left world" : null,
        driver.trackStatus === "retired" ? "retired" : null,
        nearlyStopped ? "little forward progress" : null,
        positionLoss > 0 ? `${positionLoss} class position${positionLoss === 1 ? "" : "s"} lost` : null,
      ].filter((item): item is string => item != null);
      const confidence = positionLoss >= 3 && (driver.trackStatus === "off-track" || nearlyStopped) ? "likely" : "possible";
      detected.push(this.create(current, {
        kind: "crash",
        confidence,
        primaryCarIdx: driver.carIdx,
        classId: driver.classId,
        summary: `${confidence === "likely" ? "Likely" : "Possible"} crash · #${driver.carNumber}`,
        detail: `${driver.name} · ${evidence.join(" · ")}`,
      }));
    }
    return detected;
  }

  private claim(key: string, now: number, cooldown: number): boolean {
    const last = this.lastEmittedAt.get(key);
    if (last != null && now - last < cooldown) return false;
    this.lastEmittedAt.set(key, now);
    return true;
  }

  private create(session: SessionState, event: Omit<RaceEvent, "id" | "sessionId" | "at" | "sessionTime" | "lap">): RaceEvent {
    this.sequence += 1;
    return {
      ...event,
      id: `${session.id}:${this.sequence}`,
      sessionId: session.id,
      at: session.timestamp,
      sessionTime: session.timeElapsed,
      lap: session.lap,
    };
  }

  private ordinal(value: number): string {
    const suffix = value % 100 >= 11 && value % 100 <= 13 ? "th" : value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
    return `${value}${suffix}`;
  }
}
