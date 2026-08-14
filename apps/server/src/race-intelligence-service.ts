import type {
  BattleSummary,
  DriverChangeContext,
  DriverState,
  DriverStintSummary,
  GapTrend,
  PitCycleSummary,
  RaceIntelligenceSnapshot,
  SessionState,
  TimingQualityWarning,
  TrendSuppressionReason,
} from "@racecontrol/protocol";

interface GapSample { at: number; gap: number; }
interface StintState extends DriverStintSummary { startLap: number; }

const historyWindowSeconds = 30;
const minimumTrendWindowSeconds = 5;
const battleGapSeconds = 3;

export class RaceIntelligenceService {
  private sessionId: string | null = null;
  private readonly histories = new Map<string, GapSample[]>();
  private readonly stints = new Map<number, StintState>();
  private readonly pitVisits = new Map<number, Map<number, PitCycleSummary>>();
  private cached: RaceIntelligenceSnapshot | null = null;
  private lastPublishedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly publishIntervalMs = 750,
  ) {}

  ingest(session: SessionState): void {
    if (this.sessionId !== session.id) this.reset(session.id);
    const at = session.timeElapsed ?? this.clock() / 1_000;
    this.ingestStints(session, at);
    this.ingestPitCycles(session);
    this.ingestGapSamples(session, at);
    const now = this.clock();
    if (this.cached == null || now - this.lastPublishedAt >= this.publishIntervalMs) {
      this.cached = deepFreeze(this.buildSnapshot(session, at, now));
      this.lastPublishedAt = now;
    }
  }

  snapshot(): RaceIntelligenceSnapshot | null {
    return this.cached;
  }

  private reset(sessionId: string): void {
    this.sessionId = sessionId;
    this.histories.clear();
    this.stints.clear();
    this.pitVisits.clear();
    this.cached = null;
    this.lastPublishedAt = Number.NEGATIVE_INFINITY;
  }

  private ingestGapSamples(session: SessionState, at: number): void {
    for (const group of groupByClass(session.drivers)) {
      const ordered = group.filter((driver) => driver.classPosition > 0).sort((a, b) => a.classPosition - b.classPosition);
      for (let index = 1; index < ordered.length; index++) {
        const ahead = ordered[index - 1]!;
        const chasing = ordered[index]!;
        const key = pairKey(ahead, chasing);
        const suppression = suppressTrend(session, ahead, chasing);
        if (suppression || chasing.classIntervalToAhead == null) {
          this.histories.delete(key);
          continue;
        }
        const history = this.histories.get(key) ?? [];
        history.push({ at, gap: chasing.classIntervalToAhead });
        while (history.length > 0 && history[0]!.at < at - historyWindowSeconds) history.shift();
        this.histories.set(key, history);
      }
    }
  }

  private ingestStints(session: SessionState, at: number): void {
    for (const driver of session.drivers) {
      const driverId = identity(driver);
      const current = this.stints.get(driver.carIdx);
      if (!current) {
        this.stints.set(driver.carIdx, {
          carIdx: driver.carIdx, currentDriverId: driverId, currentDriverName: driver.name,
          startedAt: at, duration: 0, lapCount: 0, quality: "valid", startLap: driver.lapsCompleted,
        });
        continue;
      }
      if (current.currentDriverId === driverId) {
        current.duration = Math.max(0, at - current.startedAt);
        current.lapCount = Math.max(0, driver.lapsCompleted - current.startLap);
        continue;
      }
      const context = driverChangeContext(driver);
      const quality = context === "away-from-pits" ? "invalid" : context === "unresolved" || context === "inferred-box" ? "inferred" : "valid";
      const completed = {
        driverId: current.currentDriverId,
        driverName: current.currentDriverName,
        startedAt: current.startedAt,
        endedAt: at,
        duration: Math.max(0, at - current.startedAt),
        lapCount: Math.max(0, driver.lapsCompleted - current.startLap),
        changeContext: context,
        associatedPitEntryTime: driver.latestPitVisit?.pitEntryTime,
        quality,
      } as const;
      this.stints.set(driver.carIdx, {
        carIdx: driver.carIdx, currentDriverId: driverId, currentDriverName: driver.name,
        previousDriverId: current.currentDriverId, previousDriverName: current.currentDriverName,
        startedAt: at, duration: 0, lapCount: 0, recentCompleted: completed,
        changeContext: context, associatedPitEntryTime: driver.latestPitVisit?.pitEntryTime,
        quality, startLap: driver.lapsCompleted,
      });
    }
  }

  private ingestPitCycles(session: SessionState): void {
    for (const driver of session.drivers) {
      const visit = driver.latestPitVisit;
      if (!visit) continue;
      const visits = this.pitVisits.get(driver.carIdx) ?? new Map<number, PitCycleSummary>();
      visits.set(visit.pitEntryTime, {
        carIdx: driver.carIdx,
        stopCount: visits.size + (visits.has(visit.pitEntryTime) ? 0 : 1),
        lastPitEntryTime: visit.pitEntryTime,
        lastPitExitTime: visit.pitExitTime,
        totalPitLaneTime: visit.pitLaneTime,
        totalBoxTime: visit.boxTime,
        totalUnknownTime: visit.unknownTime,
        quality: visit.quality === "valid" ? "valid" : visit.quality === "contains-inference" ? "inferred" : "incomplete",
      });
      this.pitVisits.set(driver.carIdx, visits);
    }
  }

  private buildSnapshot(session: SessionState, at: number, now: number): RaceIntelligenceSnapshot {
    const trends: GapTrend[] = [];
    const battles: BattleSummary[] = [];
    const byCar = new Map(session.drivers.map((driver) => [driver.carIdx, driver]));
    for (const classDrivers of groupByClass(session.drivers)) {
      const ordered = classDrivers.filter((driver) => driver.classPosition > 0).sort((a, b) => a.classPosition - b.classPosition);
      for (let index = 1; index < ordered.length; index++) {
        const ahead = ordered[index - 1]!;
        const chasing = ordered[index]!;
        const trend = this.trendFor(session, ahead, chasing, at);
        trends.push(trend);
        if (trend.quality === "valid" && trend.currentGap != null && trend.currentGap <= battleGapSeconds) {
          battles.push({
            id: `battle:${pairKey(ahead, chasing)}`, classId: chasing.classId, className: chasing.className,
            carIdxs: [ahead.carIdx, chasing.carIdx], currentGap: trend.currentGap, lapDeficit: 0,
            windowSeconds: trend.windowSeconds, direction: trend.direction, rate: trend.rate, quality: "valid",
          });
        }
      }
    }
    const pitCycles = [...this.pitVisits.entries()].map(([carIdx, visits]) => {
      const ordered = [...visits.values()].sort((a, b) => (a.lastPitEntryTime ?? 0) - (b.lastPitEntryTime ?? 0));
      const latest = ordered.at(-1)!;
      return {
        ...latest, carIdx, stopCount: ordered.length,
        totalPitLaneTime: ordered.reduce((sum, visit) => sum + visit.totalPitLaneTime, 0),
        totalBoxTime: ordered.reduce((sum, visit) => sum + visit.totalBoxTime, 0),
        totalUnknownTime: ordered.reduce((sum, visit) => sum + visit.totalUnknownTime, 0),
      };
    });
    return {
      sessionId: session.id,
      generatedAt: now,
      battles: battles.sort((a, b) => (a.currentGap ?? Infinity) - (b.currentGap ?? Infinity)),
      gapTrends: trends,
      pitCycles,
      stints: [...this.stints.values()].map(({ startLap: _, ...stint }) => ({ ...stint })),
      qualityWarnings: qualityWarnings(session, at, byCar),
    };
  }

  private trendFor(session: SessionState, ahead: DriverState, chasing: DriverState, at: number): GapTrend {
    const suppressionReason = suppressTrend(session, ahead, chasing);
    const lapDeficit = Math.max(ahead.currentLap - chasing.currentLap, 0);
    const history = this.histories.get(pairKey(ahead, chasing)) ?? [];
    const windowSeconds = history.length > 1 ? history.at(-1)!.at - history[0]!.at : 0;
    const base = {
      id: `trend:${pairKey(ahead, chasing)}`, referenceCarIdx: ahead.carIdx, chasingCarIdx: chasing.carIdx,
      classId: chasing.classId, currentGap: lapDeficit === 0 ? chasing.classIntervalToAhead ?? undefined : undefined,
      lapDeficit, windowSeconds,
    };
    if (suppressionReason) return { ...base, quality: "invalid", suppressionReason };
    if (history.length < 3 || windowSeconds < minimumTrendWindowSeconds)
      return { ...base, quality: "incomplete", suppressionReason: "insufficient-history" };
    const gapChange = history.at(-1)!.gap - history[0]!.gap;
    const rate = gapChange / windowSeconds;
    const direction = Math.abs(rate) < 0.02 ? "stable" : rate < 0 ? "closing" : "opening";
    return { ...base, currentGap: history.at(-1)!.gap, gapChange, rate, direction, quality: "valid" };
  }
}

function pairKey(ahead: DriverState, chasing: DriverState): string {
  return `${chasing.classId}:${ahead.carIdx}:${chasing.carIdx}`;
}

function groupByClass(drivers: DriverState[]): DriverState[][] {
  const groups = new Map<number, DriverState[]>();
  for (const driver of drivers) {
    const group = groups.get(driver.classId) ?? [];
    group.push(driver);
    groups.set(driver.classId, group);
  }
  return [...groups.values()];
}

function identity(driver: DriverState): string {
  return driver.userId > 0 ? `user:${driver.userId}` : `name:${driver.name.trim().toLowerCase()}`;
}

function driverChangeContext(driver: DriverState): DriverChangeContext {
  if (driver.pitState === "pit-stall" && (driver.latestPitVisit?.inferredBoxTime ?? 0) === 0) return "observed-box";
  if ((driver.latestPitVisit?.inferredBoxTime ?? 0) > 0) return "inferred-box";
  if (driver.pitState === "unobserved" || (driver.latestPitVisit?.unknownTime ?? 0) > 0 ||
      (driver.latestPitVisit && driver.latestPitVisit.pitExitTime == null)) return "unresolved";
  return "away-from-pits";
}

function suppressTrend(session: SessionState, ahead: DriverState, chasing: DriverState): TrendSuppressionReason | undefined {
  if (session.flag === "yellow") return "caution";
  if (ahead.currentLap !== chasing.currentLap || ahead.lapsBehindClassLeader !== chasing.lapsBehindClassLeader) return "lap-deficit";
  if (ahead.onPitRoad || chasing.onPitRoad || ahead.pitState === "pit-lane" || chasing.pitState === "pit-lane" ||
      ahead.pitState === "pit-stall" || chasing.pitState === "pit-stall") return "pit-transition";
  for (const driver of [ahead, chasing]) {
    const quality = driver.timingQuality?.classIntervalToAhead;
    if (quality?.reason === "position-reset") return "position-reset";
    if (quality?.reason === "tow") return "tow";
    if (quality && quality.quality !== "valid") return "telemetry-gap";
    if (!driver.isConnected || driver.pitState === "unobserved") return "telemetry-gap";
  }
  return undefined;
}

function qualityWarnings(session: SessionState, at: number, _byCar: Map<number, DriverState>): TimingQualityWarning[] {
  const warnings: TimingQualityWarning[] = [];
  for (const driver of session.drivers) {
    for (const [field, quality] of Object.entries(driver.timingQuality ?? {})) {
      if (!quality || quality.quality === "valid") continue;
      warnings.push({
        id: `${driver.carIdx}:${field}:${quality.reason ?? quality.quality}`,
        carIdx: driver.carIdx, field, quality: quality.quality, reason: quality.reason,
        message: `#${driver.carNumber} ${field} is ${quality.quality}${quality.reason ? ` (${quality.reason.replaceAll("-", " ")})` : ""}.`,
        observedAt: quality.observedAt ?? at,
      });
    }
    for (const sector of [...(driver.sectors?.currentLap ?? []), ...(driver.sectors?.previousLap ?? [])]) {
      if (sector.quality === "valid") continue;
      warnings.push({
        id: `${driver.carIdx}:sector:${sector.lapNumber}:${sector.sectorNumber}:${sector.definitionRevision}`,
        carIdx: driver.carIdx, field: `sector-${sector.sectorNumber}`, quality: sector.quality,
        reason: sector.reason, message: `#${driver.carNumber} S${sector.sectorNumber} is ${sector.quality}.`,
        observedAt: sector.observedAt ?? at,
      });
    }
  }
  return warnings.slice(-50);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
