import { randomUUID } from "node:crypto";
import type {
  ClassGapHistoryPoint,
  CompletedLap,
  CompletedSector,
  CompletedSessionReview,
  CompletedSessionResult,
  DriverState,
  HistorySessionSummary,
  SectorDefinition,
  SessionState,
} from "@racecontrol/protocol";
import { Pool, type PoolClient } from "pg";

export interface RaceHistoryRepository {
  initialize(): Promise<void>;
  observeSession(session: SessionState, completed: boolean): Promise<void>;
  listSessions(externalSubSessionId?: number): Promise<HistorySessionSummary[]>;
  reviewSession(historySessionId: string, revision?: string): Promise<CompletedSessionReview | null>;
  listSessionSectors(historySessionId: string, carIdx: number, revision: string | undefined, limit: number): Promise<CompletedSector[] | null>;
  recordLap(session: SessionState, driver: DriverState, startingPosition?: number | null): Promise<CompletedLap | null>;
  listLaps(session: SessionState, carIdx: number, limit: number): Promise<CompletedLap[]>;
  listClassGaps(session: SessionState, classId: number, afterLapByCar: ReadonlyMap<number, number>): Promise<ClassGapHistoryPoint[]>;
  recordSectors(session: SessionState, driver: DriverState, definition: SectorDefinition, sectors: CompletedSector[]): Promise<CompletedSector[]>;
  listSectors(session: SessionState, carIdx: number, limit: number): Promise<CompletedSector[]>;
  close(): Promise<void>;
}

interface MemorySessionRecord {
  id: string;
  snapshot: SessionState;
  firstSeenAt: string;
  lastSeenAt: string;
  completedAt: string | null;
}

function sessionKey(session: Pick<SessionState, "source" | "sourceMode" | "id">): string {
  return `${session.source}:${session.sourceMode}:${session.id}`;
}

function bestSectors(sectors: readonly CompletedSector[]): Map<number, CompletedSector[]> {
  const byCar = new Map<number, Map<number, CompletedSector>>();
  for (const sector of sectors) {
    if (sector.quality !== "valid" || sector.value == null || !Number.isFinite(sector.value)) continue;
    const byNumber = byCar.get(sector.carIdx) ?? new Map<number, CompletedSector>();
    const current = byNumber.get(sector.sectorNumber);
    if (!current || sector.value < current.value!) byNumber.set(sector.sectorNumber, sector);
    byCar.set(sector.carIdx, byNumber);
  }
  return new Map([...byCar].map(([carIdx, values]) => [
    carIdx,
    [...values.values()].sort((left, right) => left.sectorNumber - right.sectorNumber),
  ]));
}

function resultFromDriver(driver: DriverState, sectors: CompletedSector[]): CompletedSessionResult {
  return {
    carIdx: driver.carIdx,
    position: driver.position,
    classPosition: driver.classPosition,
    carNumber: driver.carNumber,
    name: driver.name,
    team: driver.team,
    classId: driver.classId,
    className: driver.className,
    classColor: driver.classColor,
    lapsCompleted: driver.lapsCompleted,
    lastLap: driver.lastLap,
    bestLap: driver.bestLap,
    gapToLeader: driver.gapToLeader,
    classGapToLeader: driver.classGapToLeader,
    lapsBehindLeader: driver.lapsBehindLeader,
    lapsBehindClassLeader: driver.lapsBehindClassLeader,
    trackStatus: driver.trackStatus,
    bestSectors: sectors,
  };
}

function milliseconds(seconds: number | null | undefined): number | null {
  return seconds == null || !Number.isFinite(seconds) ? null : Math.round(seconds * 1_000);
}

function seconds(value: number | string | null): number | null {
  return value == null ? null : Number(value) / 1_000;
}

function observedAt(session: SessionState): string {
  const parsed = new Date(session.timestamp);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

function lapRecord(id: string, session: SessionState, driver: DriverState): CompletedLap {
  return {
    id,
    sessionId: session.id,
    source: session.source,
    sourceMode: session.sourceMode,
    carIdx: driver.carIdx,
    carNumber: driver.carNumber,
    driverName: driver.name,
    classId: driver.classId,
    className: driver.className,
    lapNumber: driver.lastLapNumber!,
    lapTime: driver.lastLap!,
    position: driver.lastLapPosition,
    classPosition: driver.lastLapClassPosition,
    gapToLeader: driver.lastLapGapToLeader,
    gapToClassLeader: driver.lastLapGapToClassLeader,
    lapsBehindLeader: driver.lastLapLapsBehindLeader,
    lapsBehindClassLeader: driver.lastLapLapsBehindClassLeader,
    personalBest: driver.lastLapNumber === driver.bestLapNumber,
    sessionTime: session.timeElapsed,
    flag: session.flag,
    phase: session.phase,
    observedAt: observedAt(session),
  };
}

export class MemoryRaceHistoryRepository implements RaceHistoryRepository {
  private readonly records = new Map<string, CompletedLap>();
  private readonly sectors = new Map<string, { sessionKey: string; sector: CompletedSector }>();
  private readonly definitions = new Map<string, SectorDefinition>();
  private readonly sessions = new Map<string, MemorySessionRecord>();

  async initialize(): Promise<void> {}

  async observeSession(session: SessionState, completed: boolean): Promise<void> {
    const key = sessionKey(session);
    const current = this.sessions.get(key);
    const at = observedAt(session);
    this.sessions.set(key, {
      id: current?.id ?? randomUUID(),
      snapshot: structuredClone(session),
      firstSeenAt: current?.firstSeenAt ?? at,
      lastSeenAt: at,
      completedAt: completed ? at : current?.completedAt ?? null,
    });
  }

  async listSessions(externalSubSessionId?: number): Promise<HistorySessionSummary[]> {
    return [...this.sessions.values()]
      .filter((record) => record.completedAt != null)
      .filter((record) => externalSubSessionId == null || record.snapshot.externalSubSessionId === externalSubSessionId)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .map((record) => this.summary(record));
  }

  async reviewSession(historySessionId: string, revision?: string): Promise<CompletedSessionReview | null> {
    const record = [...this.sessions.values()].find((candidate) => candidate.id === historySessionId && candidate.completedAt != null);
    if (!record) return null;
    const sectors = [...this.sectors.values()]
      .filter((candidate) => candidate.sessionKey === sessionKey(record.snapshot))
      .map((candidate) => candidate.sector);
    const definitions = [...this.definitions.entries()]
      .filter(([key]) => key.startsWith(`${sessionKey(record.snapshot)}:`))
      .map(([, definition]) => structuredClone(definition));
    const selectedRevision = revision && definitions.some((definition) => definition.revision === revision)
      ? revision
      : definitions.at(-1)?.revision ?? null;
    const fastest = bestSectors(sectors.filter((sector) => selectedRevision == null || sector.definitionRevision === selectedRevision));
    return {
      session: this.summary(record),
      classes: structuredClone(record.snapshot.classes),
      results: record.snapshot.drivers
        .map((driver) => resultFromDriver(driver, structuredClone(fastest.get(driver.carIdx) ?? [])))
        .sort((left, right) => left.position - right.position),
      sectorDefinitions: definitions,
      sectorRevision: selectedRevision,
    };
  }

  async listSessionSectors(historySessionId: string, carIdx: number, revision: string | undefined, limit: number): Promise<CompletedSector[] | null> {
    const record = [...this.sessions.values()].find((candidate) => candidate.id === historySessionId && candidate.completedAt != null);
    if (!record) return null;
    return [...this.sectors.values()]
      .filter((candidate) => candidate.sessionKey === sessionKey(record.snapshot) && candidate.sector.carIdx === carIdx)
      .map((candidate) => candidate.sector)
      .filter((sector) => revision == null || sector.definitionRevision === revision)
      .sort((left, right) => left.lapNumber - right.lapNumber || left.sectorNumber - right.sectorNumber)
      .slice(-limit)
      .map((sector) => structuredClone(sector));
  }

  async recordLap(session: SessionState, driver: DriverState, _startingPosition?: number | null): Promise<CompletedLap | null> {
    const key = `${session.source}:${session.sourceMode}:${session.id}:${driver.carIdx}:${driver.lastLapNumber}`;
    if (this.records.has(key)) return null;
    const record = lapRecord(randomUUID(), session, driver);
    this.records.set(key, record);
    return structuredClone(record);
  }

  async listLaps(session: SessionState, carIdx: number, limit: number): Promise<CompletedLap[]> {
    return [...this.records.values()]
      .filter((lap) => lap.sessionId === session.id && lap.source === session.source && lap.sourceMode === session.sourceMode && lap.carIdx === carIdx)
      .sort((left, right) => right.lapNumber - left.lapNumber)
      .slice(0, limit)
      .reverse()
      .map((lap) => structuredClone(lap));
  }

  async listClassGaps(session: SessionState, classId: number, afterLapByCar: ReadonlyMap<number, number>): Promise<ClassGapHistoryPoint[]> {
    return [...this.records.values()]
      .filter((lap) => lap.sessionId === session.id
        && lap.source === session.source
        && lap.sourceMode === session.sourceMode
        && lap.classId === classId
        && lap.lapNumber > (afterLapByCar.get(lap.carIdx) ?? 0))
      .sort((left, right) => left.lapNumber - right.lapNumber || left.carIdx - right.carIdx)
      .map((lap) => ({
        carIdx: lap.carIdx,
        lapNumber: lap.lapNumber,
        classPosition: lap.classPosition,
        gapToClassLeader: lap.gapToClassLeader,
        lapsBehindClassLeader: lap.lapsBehindClassLeader,
      }));
  }

  async recordSectors(session: SessionState, _driver: DriverState, definition: SectorDefinition, sectors: CompletedSector[]): Promise<CompletedSector[]> {
    this.definitions.set(`${session.source}:${session.sourceMode}:${session.id}:${definition.revision}`, structuredClone(definition));
    const inserted: CompletedSector[] = [];
    for (const sector of sectors) {
      const key = `${session.source}:${session.sourceMode}:${session.id}:${sector.carIdx}:${sector.lapNumber}:${sector.sectorNumber}:${sector.definitionRevision}`;
      if (this.sectors.has(key)) continue;
      this.sectors.set(key, { sessionKey: `${session.source}:${session.sourceMode}:${session.id}`, sector: structuredClone(sector) });
      inserted.push(structuredClone(sector));
    }
    return inserted;
  }

  async listSectors(session: SessionState, carIdx: number, limit: number): Promise<CompletedSector[]> {
    const sessionKey = `${session.source}:${session.sourceMode}:${session.id}`;
    return [...this.sectors.values()]
      .filter((record) => record.sessionKey === sessionKey && record.sector.carIdx === carIdx)
      .map((record) => record.sector)
      .sort((left, right) => left.lapNumber - right.lapNumber || left.sectorNumber - right.sectorNumber)
      .slice(-limit)
      .map((sector) => structuredClone(sector));
  }

  async close(): Promise<void> {}

  private summary(record: MemorySessionRecord): HistorySessionSummary {
    const key = sessionKey(record.snapshot);
    return {
      id: record.id,
      sourceSessionId: record.snapshot.id,
      source: record.snapshot.source,
      sourceMode: record.snapshot.sourceMode,
      externalSubSessionId: record.snapshot.externalSubSessionId,
      externalSessionNumber: record.snapshot.externalSessionNumber,
      name: record.snapshot.name,
      type: record.snapshot.type,
      trackId: record.snapshot.trackId,
      trackName: record.snapshot.trackName,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      completedAt: record.completedAt,
      resultCount: record.snapshot.drivers.length,
      sectorCount: [...this.sectors.values()].filter((candidate) => candidate.sessionKey === key).length,
    };
  }
}

interface LapRow {
  id: string;
  source_session_id: string;
  source: CompletedLap["source"];
  source_mode: CompletedLap["sourceMode"];
  car_idx: number;
  car_number: string;
  driver_name: string;
  class_id: number;
  class_name: string;
  lap_number: number;
  lap_time_ms: number;
  position: number | null;
  class_position: number | null;
  scoring_gap_to_leader_ms: number | null;
  scoring_gap_to_class_leader_ms: number | null;
  laps_behind_leader: number | null;
  laps_behind_class_leader: number | null;
  personal_best: boolean;
  session_time_ms: number | string | null;
  flag: CompletedLap["flag"];
  phase: CompletedLap["phase"];
  observed_at: Date;
}

interface SessionSummaryRow {
  id: string;
  source_session_id: string;
  source: HistorySessionSummary["source"];
  source_mode: HistorySessionSummary["sourceMode"];
  external_subsession_id: number | string | null;
  external_session_number: number | null;
  name: string;
  session_type: HistorySessionSummary["type"];
  track_id: number | null;
  track_name: string;
  first_seen_at: Date;
  last_seen_at: Date;
  completed_at: Date | null;
  result_count: number | string;
  sector_count: number | string;
  final_snapshot?: SessionState;
}

interface SectorRow {
  car_idx: number;
  lap_number: number;
  sector_number: number;
  revision: string;
  timing_source: CompletedSector["source"];
  quality: CompletedSector["quality"];
  invalidity_reason: CompletedSector["reason"] | null;
  elapsed_ms: number | null;
  completion_session_time_ms: number | string | null;
  driver_name: string;
}

function historySummary(row: SessionSummaryRow): HistorySessionSummary {
  return {
    id: row.id,
    sourceSessionId: row.source_session_id,
    source: row.source,
    sourceMode: row.source_mode,
    externalSubSessionId: row.external_subsession_id == null ? null : Number(row.external_subsession_id),
    externalSessionNumber: row.external_session_number,
    name: row.name,
    type: row.session_type,
    trackId: row.track_id,
    trackName: row.track_name,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    resultCount: Number(row.result_count),
    sectorCount: Number(row.sector_count),
  };
}

function sectorsFromRows(rows: SectorRow[]): CompletedSector[] {
  return rows.map((row) => ({
    carIdx: row.car_idx,
    lapNumber: row.lap_number,
    sectorNumber: row.sector_number,
    definitionRevision: row.revision,
    source: row.timing_source,
    quality: row.quality,
    value: seconds(row.elapsed_ms) ?? undefined,
    reason: row.invalidity_reason ?? undefined,
    completedAt: seconds(row.completion_session_time_ms) ?? undefined,
    driverName: row.driver_name,
  }));
}

export class PostgresRaceHistoryRepository implements RaceHistoryRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bg_broadcast_sessions (
        id uuid PRIMARY KEY,
        source text NOT NULL,
        source_mode text NOT NULL CHECK (source_mode IN ('live', 'replay', 'simulation')),
        source_session_id text NOT NULL,
        external_subsession_id bigint,
        external_session_number integer,
        name text NOT NULL,
        session_type text NOT NULL CHECK (session_type IN ('practice', 'qualifying', 'race')),
        track_id integer,
        track_name text NOT NULL,
        total_laps integer,
        total_time_ms bigint,
        first_seen_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        completed_at timestamptz,
        UNIQUE (source, source_mode, source_session_id)
      );
      CREATE INDEX IF NOT EXISTS bg_broadcast_sessions_last_seen_idx
        ON bg_broadcast_sessions (last_seen_at DESC);

      ALTER TABLE bg_broadcast_sessions
        ADD COLUMN IF NOT EXISTS final_snapshot jsonb;

      CREATE TABLE IF NOT EXISTS bg_session_classes (
        session_id uuid NOT NULL REFERENCES bg_broadcast_sessions(id) ON DELETE CASCADE,
        class_id integer NOT NULL,
        name text NOT NULL,
        color text NOT NULL,
        car_count integer NOT NULL,
        PRIMARY KEY (session_id, class_id)
      );

      CREATE TABLE IF NOT EXISTS bg_session_entries (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES bg_broadcast_sessions(id) ON DELETE CASCADE,
        car_idx integer NOT NULL,
        car_number text NOT NULL,
        team_id bigint,
        team_name text NOT NULL,
        car_id integer,
        class_id integer NOT NULL,
        starting_position integer,
        first_seen_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        UNIQUE (session_id, car_idx),
        FOREIGN KEY (session_id, class_id) REFERENCES bg_session_classes(session_id, class_id)
      );

      CREATE TABLE IF NOT EXISTS bg_session_drivers (
        id uuid PRIMARY KEY,
        entry_id uuid NOT NULL REFERENCES bg_session_entries(id) ON DELETE CASCADE,
        driver_key text NOT NULL,
        external_user_id bigint,
        name text NOT NULL,
        first_seen_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        UNIQUE (entry_id, driver_key)
      );

      CREATE TABLE IF NOT EXISTS bg_completed_laps (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES bg_broadcast_sessions(id) ON DELETE CASCADE,
        entry_id uuid NOT NULL REFERENCES bg_session_entries(id) ON DELETE CASCADE,
        driver_id uuid NOT NULL REFERENCES bg_session_drivers(id) ON DELETE RESTRICT,
        lap_number integer NOT NULL CHECK (lap_number > 0),
        lap_time_ms integer NOT NULL CHECK (lap_time_ms > 0),
        position integer,
        class_position integer,
        scoring_gap_to_leader_ms integer,
        scoring_gap_to_class_leader_ms integer,
        laps_behind_leader integer,
        laps_behind_class_leader integer,
        personal_best boolean NOT NULL,
        session_time_ms bigint,
        flag text NOT NULL,
        phase text NOT NULL,
        track_status text NOT NULL,
        on_pit_road boolean NOT NULL,
        observed_at timestamptz NOT NULL,
        UNIQUE (session_id, entry_id, lap_number)
      );
      CREATE INDEX IF NOT EXISTS bg_completed_laps_entry_lap_idx
        ON bg_completed_laps (entry_id, lap_number DESC);
      CREATE INDEX IF NOT EXISTS bg_completed_laps_session_lap_idx
        ON bg_completed_laps (session_id, lap_number DESC);

      CREATE TABLE IF NOT EXISTS bg_sector_definitions (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES bg_broadcast_sessions(id) ON DELETE CASCADE,
        revision text NOT NULL,
        source text NOT NULL CHECK (source IN ('iracing')),
        track_id integer,
        track_name text NOT NULL,
        observed_at timestamptz NOT NULL,
        UNIQUE (session_id, revision)
      );
      CREATE TABLE IF NOT EXISTS bg_sector_definition_points (
        definition_id uuid NOT NULL REFERENCES bg_sector_definitions(id) ON DELETE CASCADE,
        ordinal integer NOT NULL,
        sector_number integer NOT NULL,
        start_pct double precision NOT NULL CHECK (start_pct >= 0 AND start_pct < 1),
        PRIMARY KEY (definition_id, ordinal),
        UNIQUE (definition_id, sector_number)
      );
      CREATE TABLE IF NOT EXISTS bg_completed_sectors (
        id uuid PRIMARY KEY,
        session_id uuid NOT NULL REFERENCES bg_broadcast_sessions(id) ON DELETE CASCADE,
        entry_id uuid NOT NULL REFERENCES bg_session_entries(id) ON DELETE CASCADE,
        driver_id uuid NOT NULL REFERENCES bg_session_drivers(id) ON DELETE RESTRICT,
        definition_id uuid NOT NULL REFERENCES bg_sector_definitions(id) ON DELETE RESTRICT,
        lap_number integer NOT NULL CHECK (lap_number > 0),
        sector_number integer NOT NULL,
        elapsed_ms integer,
        timing_source text NOT NULL CHECK (timing_source IN ('iracing', 'derived')),
        quality text NOT NULL CHECK (quality IN ('valid', 'inferred', 'incomplete', 'invalid')),
        invalidity_reason text,
        completion_session_time_ms bigint,
        observed_at timestamptz NOT NULL,
        UNIQUE (session_id, entry_id, lap_number, sector_number, definition_id)
      );
      CREATE INDEX IF NOT EXISTS bg_completed_sectors_entry_lap_idx
        ON bg_completed_sectors (entry_id, lap_number DESC, sector_number);

      ALTER TABLE bg_sector_definitions DROP CONSTRAINT IF EXISTS bg_sector_definitions_source_check;
      ALTER TABLE bg_sector_definitions ADD CONSTRAINT bg_sector_definitions_source_check CHECK (source IN ('iracing', 'custom'));

      UPDATE bg_broadcast_sessions previous
      SET completed_at = previous.last_seen_at
      WHERE previous.completed_at IS NULL
        AND previous.external_subsession_id IS NOT NULL
        AND previous.external_session_number IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM bg_broadcast_sessions later
          WHERE later.source = previous.source
            AND later.source_mode = previous.source_mode
            AND later.external_subsession_id = previous.external_subsession_id
            AND later.external_session_number > previous.external_session_number
        );
    `);
  }

  async observeSession(session: SessionState, completed: boolean): Promise<void> {
    const at = observedAt(session);
    await this.pool.query(`
      INSERT INTO bg_broadcast_sessions (
        id, source, source_mode, source_session_id, external_subsession_id, external_session_number,
        name, session_type, track_id, track_name, total_laps, total_time_ms,
        first_seen_at, last_seen_at, completed_at, final_snapshot
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15::jsonb)
      ON CONFLICT (source, source_mode, source_session_id) DO UPDATE SET
        external_subsession_id = COALESCE(EXCLUDED.external_subsession_id, bg_broadcast_sessions.external_subsession_id),
        external_session_number = COALESCE(EXCLUDED.external_session_number, bg_broadcast_sessions.external_session_number),
        name = EXCLUDED.name,
        session_type = EXCLUDED.session_type,
        track_id = COALESCE(EXCLUDED.track_id, bg_broadcast_sessions.track_id),
        track_name = EXCLUDED.track_name,
        total_laps = COALESCE(EXCLUDED.total_laps, bg_broadcast_sessions.total_laps),
        total_time_ms = COALESCE(EXCLUDED.total_time_ms, bg_broadcast_sessions.total_time_ms),
        last_seen_at = EXCLUDED.last_seen_at,
        completed_at = COALESCE(EXCLUDED.completed_at, bg_broadcast_sessions.completed_at),
        final_snapshot = COALESCE(EXCLUDED.final_snapshot, bg_broadcast_sessions.final_snapshot)
    `, [
      randomUUID(), session.source, session.sourceMode, session.id, session.externalSubSessionId,
      session.externalSessionNumber, session.name, session.type, session.trackId, session.trackName,
      session.totalLaps, milliseconds(session.totalTime), at, completed ? at : null,
      completed ? JSON.stringify(session) : null,
    ]);
  }

  async listSessions(externalSubSessionId?: number): Promise<HistorySessionSummary[]> {
    const result = await this.pool.query<SessionSummaryRow>(`
      SELECT session.id, session.source_session_id, session.source, session.source_mode,
             session.external_subsession_id, session.external_session_number, session.name,
             session.session_type, session.track_id, session.track_name, session.first_seen_at,
             session.last_seen_at, session.completed_at,
             CASE WHEN session.final_snapshot IS NOT NULL THEN jsonb_array_length(session.final_snapshot->'drivers')
               ELSE (SELECT count(*) FROM bg_session_entries entry WHERE entry.session_id = session.id) END AS result_count,
             (SELECT count(*) FROM bg_completed_sectors sector WHERE sector.session_id = session.id) AS sector_count
      FROM bg_broadcast_sessions session
      WHERE session.completed_at IS NOT NULL
        AND ($1::bigint IS NULL OR session.external_subsession_id = $1)
      ORDER BY session.last_seen_at DESC
      LIMIT 100
    `, [externalSubSessionId ?? null]);
    return result.rows.map(historySummary);
  }

  async reviewSession(historySessionId: string, revision?: string): Promise<CompletedSessionReview | null> {
    const result = await this.pool.query<SessionSummaryRow>(`
      SELECT session.id, session.source_session_id, session.source, session.source_mode,
             session.external_subsession_id, session.external_session_number, session.name,
             session.session_type, session.track_id, session.track_name, session.first_seen_at,
             session.last_seen_at, session.completed_at, session.final_snapshot,
             CASE WHEN session.final_snapshot IS NOT NULL THEN jsonb_array_length(session.final_snapshot->'drivers')
               ELSE (SELECT count(*) FROM bg_session_entries entry WHERE entry.session_id = session.id) END AS result_count,
             (SELECT count(*) FROM bg_completed_sectors sector WHERE sector.session_id = session.id) AS sector_count
      FROM bg_broadcast_sessions session
      WHERE session.id = $1 AND session.completed_at IS NOT NULL
    `, [historySessionId]);
    const row = result.rows[0];
    if (!row) return null;
    const sectors = await this.sectorsForHistorySession(historySessionId);
    const definitionRows = await this.pool.query<{
      revision: string; source: SectorDefinition["source"]; track_id: number | null; track_name: string;
      sector_number: number | null; start_pct: number | null;
    }>(`
      SELECT definition.revision, definition.source, definition.track_id, definition.track_name,
             point.sector_number, point.start_pct
      FROM bg_sector_definitions definition
      LEFT JOIN bg_sector_definition_points point ON point.definition_id = definition.id
      WHERE definition.session_id = $1
      ORDER BY definition.observed_at, point.ordinal
    `, [historySessionId]);
    const definitions = new Map<string, SectorDefinition>();
    for (const definitionRow of definitionRows.rows) {
      const definition = definitions.get(definitionRow.revision) ?? {
        revision: definitionRow.revision,
        source: definitionRow.source,
        sessionId: row.source_session_id,
        trackId: definitionRow.track_id,
        trackName: definitionRow.track_name,
        boundaries: [],
      };
      if (definitionRow.sector_number != null && definitionRow.start_pct != null) {
        definition.boundaries.push({ sectorNumber: definitionRow.sector_number, startPct: definitionRow.start_pct });
      }
      definitions.set(definitionRow.revision, definition);
    }
    const selectedRevision = revision && definitions.has(revision) ? revision : [...definitions.keys()].at(-1) ?? null;
    const fastest = bestSectors(sectors.filter((sector) => selectedRevision == null || sector.definitionRevision === selectedRevision));
    const legacyClasses = row.final_snapshot ? [] : (await this.pool.query<{
      class_id: number; name: string; color: string; car_count: number;
    }>(`SELECT class_id, name, color, car_count FROM bg_session_classes WHERE session_id=$1 ORDER BY car_count DESC, name`, [historySessionId])).rows;
    const legacyResults = row.final_snapshot ? [] : (await this.pool.query<{
      car_idx: number; position: number | null; class_position: number | null; car_number: string; driver_name: string | null;
      team_name: string; class_id: number; class_name: string; class_color: string; lap_number: number | null;
      last_lap_ms: number | null; best_lap_ms: number | null; gap_to_leader_ms: number | null;
      gap_to_class_leader_ms: number | null; laps_behind_leader: number | null; laps_behind_class_leader: number | null;
      track_status: CompletedSessionResult["trackStatus"] | null;
    }>(`
      SELECT entry.car_idx, latest.position, latest.class_position, entry.car_number,
             latest.driver_name, entry.team_name, class.class_id, class.name AS class_name,
             class.color AS class_color, latest.lap_number, latest.lap_time_ms AS last_lap_ms,
             best.best_lap_ms, latest.scoring_gap_to_leader_ms AS gap_to_leader_ms,
             latest.scoring_gap_to_class_leader_ms AS gap_to_class_leader_ms,
             latest.laps_behind_leader, latest.laps_behind_class_leader, latest.track_status
      FROM bg_session_entries entry
      JOIN bg_session_classes class ON class.session_id=entry.session_id AND class.class_id=entry.class_id
      LEFT JOIN LATERAL (
        SELECT lap.*, driver.name AS driver_name
        FROM bg_completed_laps lap
        JOIN bg_session_drivers driver ON driver.id=lap.driver_id
        WHERE lap.entry_id=entry.id ORDER BY lap.lap_number DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT min(lap_time_ms) AS best_lap_ms FROM bg_completed_laps lap WHERE lap.entry_id=entry.id
      ) best ON true
      WHERE entry.session_id=$1
      ORDER BY latest.position NULLS LAST, entry.car_idx
    `, [historySessionId])).rows;
    const results = row.final_snapshot
      ? row.final_snapshot.drivers.map((driver) => resultFromDriver(driver, fastest.get(driver.carIdx) ?? []))
      : legacyResults.map((legacy): CompletedSessionResult => ({
        carIdx: legacy.car_idx,
        position: legacy.position ?? 0,
        classPosition: legacy.class_position ?? 0,
        carNumber: legacy.car_number,
        name: legacy.driver_name ?? "Unknown driver",
        team: legacy.team_name,
        classId: legacy.class_id,
        className: legacy.class_name,
        classColor: legacy.class_color,
        lapsCompleted: legacy.lap_number ?? 0,
        lastLap: seconds(legacy.last_lap_ms),
        bestLap: seconds(legacy.best_lap_ms),
        gapToLeader: seconds(legacy.gap_to_leader_ms),
        classGapToLeader: seconds(legacy.gap_to_class_leader_ms),
        lapsBehindLeader: legacy.laps_behind_leader ?? 0,
        lapsBehindClassLeader: legacy.laps_behind_class_leader ?? 0,
        trackStatus: legacy.track_status ?? "unknown",
        bestSectors: fastest.get(legacy.car_idx) ?? [],
      }));
    return {
      session: historySummary(row),
      classes: row.final_snapshot ? structuredClone(row.final_snapshot.classes) : legacyClasses.map((carClass) => ({
        id: carClass.class_id, name: carClass.name, color: carClass.color, carCount: carClass.car_count,
      })),
      results: results.sort((left, right) => (left.position || Number.POSITIVE_INFINITY) - (right.position || Number.POSITIVE_INFINITY)),
      sectorDefinitions: [...definitions.values()],
      sectorRevision: selectedRevision,
    };
  }

  async listSessionSectors(historySessionId: string, carIdx: number, revision: string | undefined, limit: number): Promise<CompletedSector[] | null> {
    const exists = await this.pool.query(`SELECT 1 FROM bg_broadcast_sessions WHERE id=$1 AND completed_at IS NOT NULL`, [historySessionId]);
    if (exists.rowCount !== 1) return null;
    return (await this.sectorsForHistorySession(historySessionId, carIdx, revision)).slice(-limit);
  }

  async recordLap(session: SessionState, driver: DriverState, startingPosition?: number | null): Promise<CompletedLap | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const at = observedAt(session);
      const sessionId = await this.upsertSession(client, session, at);
      await this.upsertClass(client, sessionId, session, driver);
      const entryId = await this.upsertEntry(client, sessionId, driver, at, startingPosition);
      const driverId = await this.upsertDriver(client, entryId, driver, at);
      const id = randomUUID();
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO bg_completed_laps (
          id, session_id, entry_id, driver_id, lap_number, lap_time_ms,
          position, class_position, scoring_gap_to_leader_ms, scoring_gap_to_class_leader_ms,
          laps_behind_leader, laps_behind_class_leader, personal_best, session_time_ms,
          flag, phase, track_status, on_pit_road, observed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17, $18, $19
        )
        ON CONFLICT (session_id, entry_id, lap_number) DO NOTHING
        RETURNING id
      `, [
        id, sessionId, entryId, driverId, driver.lastLapNumber, milliseconds(driver.lastLap),
        driver.lastLapPosition, driver.lastLapClassPosition, milliseconds(driver.lastLapGapToLeader),
        milliseconds(driver.lastLapGapToClassLeader), driver.lastLapLapsBehindLeader,
        driver.lastLapLapsBehindClassLeader, driver.lastLapNumber === driver.bestLapNumber,
        milliseconds(session.timeElapsed), session.flag, session.phase, driver.trackStatus,
        driver.onPitRoad, at,
      ]);
      await client.query("COMMIT");
      return inserted.rowCount === 1 ? lapRecord(id, session, driver) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listLaps(session: SessionState, carIdx: number, limit: number): Promise<CompletedLap[]> {
    const result = await this.pool.query<LapRow>(`
      SELECT lap.id, session.source, session.source_session_id, session.source_mode,
             entry.car_idx, entry.car_number, driver.name AS driver_name,
             class.class_id, class.name AS class_name,
             lap.lap_number, lap.lap_time_ms, lap.position, lap.class_position,
             lap.scoring_gap_to_leader_ms, lap.scoring_gap_to_class_leader_ms,
             lap.laps_behind_leader, lap.laps_behind_class_leader,
             lap.personal_best, lap.session_time_ms, lap.flag, lap.phase, lap.observed_at
      FROM bg_completed_laps lap
      JOIN bg_broadcast_sessions session ON session.id = lap.session_id
      JOIN bg_session_entries entry ON entry.id = lap.entry_id
      JOIN bg_session_drivers driver ON driver.id = lap.driver_id
      JOIN bg_session_classes class ON class.session_id = session.id AND class.class_id = entry.class_id
      WHERE session.source = $1 AND session.source_mode = $2
        AND session.source_session_id = $3 AND entry.car_idx = $4
      ORDER BY lap.lap_number DESC
      LIMIT $5
    `, [session.source, session.sourceMode, session.id, carIdx, limit]);
    return result.rows.reverse().map((row) => ({
      id: row.id,
      sessionId: row.source_session_id,
      source: row.source,
      sourceMode: row.source_mode,
      carIdx: row.car_idx,
      carNumber: row.car_number,
      driverName: row.driver_name,
      classId: row.class_id,
      className: row.class_name,
      lapNumber: row.lap_number,
      lapTime: row.lap_time_ms / 1_000,
      position: row.position,
      classPosition: row.class_position,
      gapToLeader: seconds(row.scoring_gap_to_leader_ms),
      gapToClassLeader: seconds(row.scoring_gap_to_class_leader_ms),
      lapsBehindLeader: row.laps_behind_leader,
      lapsBehindClassLeader: row.laps_behind_class_leader,
      personalBest: row.personal_best,
      sessionTime: seconds(row.session_time_ms),
      flag: row.flag,
      phase: row.phase,
      observedAt: row.observed_at.toISOString(),
    }));
  }

  async listClassGaps(session: SessionState, classId: number, afterLapByCar: ReadonlyMap<number, number>): Promise<ClassGapHistoryPoint[]> {
    const watermarks = Object.fromEntries([...afterLapByCar].map(([carIdx, lapNumber]) => [String(carIdx), lapNumber]));
    const result = await this.pool.query<Pick<LapRow,
      "car_idx" | "lap_number" | "class_position" | "scoring_gap_to_class_leader_ms" | "laps_behind_class_leader">>(`
      SELECT entry.car_idx, lap.lap_number, lap.class_position,
             lap.scoring_gap_to_class_leader_ms, lap.laps_behind_class_leader
      FROM bg_completed_laps lap
      JOIN bg_broadcast_sessions session ON session.id = lap.session_id
      JOIN bg_session_entries entry ON entry.id = lap.entry_id
      JOIN bg_session_classes class ON class.session_id = session.id AND class.class_id = entry.class_id
      WHERE session.source = $1 AND session.source_mode = $2
        AND session.source_session_id = $3 AND class.class_id = $4
        AND lap.lap_number > COALESCE(($5::jsonb ->> entry.car_idx::text)::integer, 0)
      ORDER BY lap.lap_number, entry.car_idx
    `, [session.source, session.sourceMode, session.id, classId, JSON.stringify(watermarks)]);
    return result.rows.map((row) => ({
      carIdx: row.car_idx,
      lapNumber: row.lap_number,
      classPosition: row.class_position,
      gapToClassLeader: seconds(row.scoring_gap_to_class_leader_ms),
      lapsBehindClassLeader: row.laps_behind_class_leader,
    }));
  }

  async recordSectors(session: SessionState, driver: DriverState, definition: SectorDefinition, sectors: CompletedSector[]): Promise<CompletedSector[]> {
    if (sectors.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const at = observedAt(session);
      const sessionId = await this.upsertSession(client, session, at);
      await this.upsertClass(client, sessionId, session, driver);
      const entryId = await this.upsertEntry(client, sessionId, driver, at);
      const definitionId = await this.upsertSectorDefinition(client, sessionId, definition, at);
      const inserted: CompletedSector[] = [];
      for (const sector of sectors) {
        const sectorDriver = driverForSector(driver, sector);
        const driverId = await this.upsertDriver(client, entryId, sectorDriver, at);
        const result = await client.query(`
          INSERT INTO bg_completed_sectors (
            id, session_id, entry_id, driver_id, definition_id, lap_number, sector_number,
            elapsed_ms, timing_source, quality, invalidity_reason, completion_session_time_ms, observed_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (session_id, entry_id, lap_number, sector_number, definition_id) DO NOTHING
          RETURNING id
        `, [randomUUID(), sessionId, entryId, driverId, definitionId, sector.lapNumber, sector.sectorNumber,
          milliseconds(sector.value), sector.source, sector.quality, sector.reason ?? null,
          milliseconds(sector.completedAt), at]);
        if (result.rowCount === 1) inserted.push(structuredClone(sector));
      }
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSectors(session: SessionState, carIdx: number, limit: number): Promise<CompletedSector[]> {
    const result = await this.pool.query<SectorRow>(`
      SELECT entry.car_idx, sector.lap_number, sector.sector_number, definition.revision,
             sector.timing_source, sector.quality, sector.invalidity_reason, sector.elapsed_ms,
             sector.completion_session_time_ms, driver.name AS driver_name
      FROM bg_completed_sectors sector
      JOIN bg_broadcast_sessions session ON session.id = sector.session_id
      JOIN bg_session_entries entry ON entry.id = sector.entry_id
      JOIN bg_session_drivers driver ON driver.id = sector.driver_id
      JOIN bg_sector_definitions definition ON definition.id = sector.definition_id
      WHERE session.source = $1 AND session.source_mode = $2 AND session.source_session_id = $3 AND entry.car_idx = $4
      ORDER BY sector.lap_number DESC, sector.sector_number DESC LIMIT $5
    `, [session.source, session.sourceMode, session.id, carIdx, limit]);
    return sectorsFromRows(result.rows.reverse());
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async upsertSession(client: PoolClient, session: SessionState, at: string): Promise<string> {
    const id = randomUUID();
    const result = await client.query<{ id: string }>(`
      INSERT INTO bg_broadcast_sessions (
        id, source, source_mode, source_session_id, external_subsession_id, external_session_number,
        name, session_type, track_id, track_name, total_laps, total_time_ms,
        first_seen_at, last_seen_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14)
      ON CONFLICT (source, source_mode, source_session_id) DO UPDATE SET
        name = EXCLUDED.name,
        track_id = COALESCE(EXCLUDED.track_id, bg_broadcast_sessions.track_id),
        track_name = EXCLUDED.track_name,
        total_laps = COALESCE(EXCLUDED.total_laps, bg_broadcast_sessions.total_laps),
        total_time_ms = COALESCE(EXCLUDED.total_time_ms, bg_broadcast_sessions.total_time_ms),
        last_seen_at = EXCLUDED.last_seen_at,
        completed_at = COALESCE(EXCLUDED.completed_at, bg_broadcast_sessions.completed_at)
      RETURNING id
    `, [
      id, session.source, session.sourceMode, session.id, session.externalSubSessionId,
      session.externalSessionNumber, session.name, session.type, session.trackId, session.trackName,
      session.totalLaps, milliseconds(session.totalTime), at,
      session.phase === "checkered" || session.phase === "cool-down" ? at : null,
    ]);
    return result.rows[0]!.id;
  }

  private async sectorsForHistorySession(historySessionId: string, carIdx?: number, revision?: string): Promise<CompletedSector[]> {
    const result = await this.pool.query<SectorRow>(`
      SELECT entry.car_idx, sector.lap_number, sector.sector_number, definition.revision,
             sector.timing_source, sector.quality, sector.invalidity_reason, sector.elapsed_ms,
             sector.completion_session_time_ms, driver.name AS driver_name
      FROM bg_completed_sectors sector
      JOIN bg_session_entries entry ON entry.id = sector.entry_id
      JOIN bg_session_drivers driver ON driver.id = sector.driver_id
      JOIN bg_sector_definitions definition ON definition.id = sector.definition_id
      WHERE sector.session_id = $1
        AND ($2::integer IS NULL OR entry.car_idx = $2)
        AND ($3::text IS NULL OR definition.revision = $3)
      ORDER BY sector.lap_number, sector.sector_number
    `, [historySessionId, carIdx ?? null, revision ?? null]);
    return sectorsFromRows(result.rows);
  }

  private async upsertClass(client: PoolClient, sessionId: string, session: SessionState, driver: DriverState): Promise<void> {
    const carClass = session.classes.find((candidate) => candidate.id === driver.classId);
    await client.query(`
      INSERT INTO bg_session_classes (session_id, class_id, name, color, car_count)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (session_id, class_id) DO UPDATE SET
        name = EXCLUDED.name, color = EXCLUDED.color, car_count = EXCLUDED.car_count
    `, [sessionId, driver.classId, carClass?.name ?? driver.className, carClass?.color ?? driver.classColor, carClass?.carCount ?? 1]);
  }

  private async upsertEntry(
    client: PoolClient,
    sessionId: string,
    driver: DriverState,
    at: string,
    startingPosition?: number | null,
  ): Promise<string> {
    const id = randomUUID();
    const result = await client.query<{ id: string }>(`
      INSERT INTO bg_session_entries (
        id, session_id, car_idx, car_number, team_id, team_name, car_id, class_id,
        starting_position, first_seen_at, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      ON CONFLICT (session_id, car_idx) DO UPDATE SET
        car_number = EXCLUDED.car_number,
        team_id = COALESCE(EXCLUDED.team_id, bg_session_entries.team_id),
        team_name = EXCLUDED.team_name,
        car_id = COALESCE(EXCLUDED.car_id, bg_session_entries.car_id),
        class_id = EXCLUDED.class_id,
        starting_position = COALESCE(bg_session_entries.starting_position, EXCLUDED.starting_position),
        last_seen_at = EXCLUDED.last_seen_at
      RETURNING id
    `, [
      id, sessionId, driver.carIdx, driver.carNumber, driver.teamId > 0 ? driver.teamId : null,
      driver.team, driver.carId > 0 ? driver.carId : null, driver.classId, startingPosition, at,
    ]);
    return result.rows[0]!.id;
  }

  private async upsertDriver(client: PoolClient, entryId: string, driver: DriverState, at: string): Promise<string> {
    const driverKey = driver.userId > 0
      ? `user:${driver.userId}`
      : `name:${driver.name.trim().toLowerCase().replace(/\s+/g, "-")}`;
    const id = randomUUID();
    const result = await client.query<{ id: string }>(`
      INSERT INTO bg_session_drivers (
        id, entry_id, driver_key, external_user_id, name, first_seen_at, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $6)
      ON CONFLICT (entry_id, driver_key) DO UPDATE SET
        name = EXCLUDED.name, last_seen_at = EXCLUDED.last_seen_at
      RETURNING id
    `, [id, entryId, driverKey, driver.userId > 0 ? driver.userId : null, driver.name, at]);
    return result.rows[0]!.id;
  }

  private async upsertSectorDefinition(client: PoolClient, sessionId: string, definition: SectorDefinition, at: string): Promise<string> {
    const result = await client.query<{ id: string }>(`
      INSERT INTO bg_sector_definitions (id, session_id, revision, source, track_id, track_name, observed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (session_id, revision) DO UPDATE SET observed_at = EXCLUDED.observed_at
      RETURNING id
    `, [randomUUID(), sessionId, definition.revision, definition.source, definition.trackId, definition.trackName, at]);
    const id = result.rows[0]!.id;
    for (let ordinal = 0; ordinal < definition.boundaries.length; ordinal++) {
      const boundary = definition.boundaries[ordinal]!;
      await client.query(`
        INSERT INTO bg_sector_definition_points (definition_id, ordinal, sector_number, start_pct)
        VALUES ($1,$2,$3,$4) ON CONFLICT (definition_id, ordinal) DO NOTHING
      `, [id, ordinal, boundary.sectorNumber, boundary.startPct]);
    }
    return id;
  }
}

function driverForSector(current: DriverState, sector: CompletedSector): DriverState {
  const numericId = Number(sector.driverId);
  return {
    ...current,
    name: sector.driverName?.trim() || current.name,
    userId: Number.isSafeInteger(numericId) && numericId > 0 ? numericId : current.userId,
  };
}

export function createRaceHistoryRepository(databaseUrl?: string): RaceHistoryRepository {
  return databaseUrl ? new PostgresRaceHistoryRepository(databaseUrl) : new MemoryRaceHistoryRepository();
}

export class RaceHistoryService {
  private readonly persistedLap = new Map<string, number>();
  private readonly startingPositions = new Map<string, number>();
  private readonly pending = new Set<string>();
  private readonly persistedSectors = new Set<string>();
  private readonly seenSessions = new Set<string>();
  private readonly terminalSignatures = new Map<string, string>();
  private readonly latestByStream = new Map<string, SessionState>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: RaceHistoryRepository,
    private readonly onLap: (lap: CompletedLap) => void = () => {},
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  ingest(session: SessionState): void {
    const key = sessionKey(session);
    const streamKey = `${session.source}:${session.sourceMode}`;
    const previous = this.latestByStream.get(streamKey);
    if (previous && sessionKey(previous) !== key) this.queueSessionObservation(previous, true);
    this.latestByStream.set(streamKey, structuredClone(session));
    if (!this.seenSessions.has(key)) {
      this.seenSessions.add(key);
      this.queueSessionObservation(session, false);
    }
    const terminal = session.phase === "checkered" || session.phase === "cool-down";
    const terminalSignature = terminal ? JSON.stringify(session.drivers.map((driver) => [
      driver.carIdx, driver.position, driver.classPosition, driver.lapsCompleted, driver.lastLap, driver.bestLap,
      driver.gapToLeader, driver.classGapToLeader, driver.lapsBehindLeader, driver.lapsBehindClassLeader, driver.trackStatus,
    ])) : null;
    if (terminalSignature != null && this.terminalSignatures.get(key) !== terminalSignature) {
      this.terminalSignatures.set(key, terminalSignature);
      this.queueSessionObservation(session, true);
    }

    for (const driver of session.drivers) {
      const entryKey = `${session.source}:${session.sourceMode}:${session.id}:${driver.carIdx}`;
      if (session.type === "race" && session.lapsCompleted === 0 && driver.position > 0 && !this.startingPositions.has(entryKey)) {
        this.startingPositions.set(entryKey, driver.position);
      }
      if (!this.isCompleteLap(session, driver)) continue;
      const key = entryKey;
      const lapNumber = driver.lastLapNumber!;
      if (lapNumber <= (this.persistedLap.get(key) ?? 0) || this.pending.has(`${key}:${lapNumber}`)) continue;
      const pendingKey = `${key}:${lapNumber}`;
      this.pending.add(pendingKey);
      this.queue = this.queue.then(async () => {
        try {
          const lap = await this.repository.recordLap(session, driver, this.startingPositions.get(entryKey));
          this.persistedLap.set(key, Math.max(lapNumber, this.persistedLap.get(key) ?? 0));
          if (lap) this.onLap(lap);
        } catch (error) {
          this.onError(error);
        } finally {
          this.pending.delete(pendingKey);
        }
      });

    }
    for (const driver of session.drivers) this.queueSectors(session, driver, `${session.source}:${session.sourceMode}:${session.id}:${driver.carIdx}`);
  }

  async listLaps(session: SessionState, carIdx: number, limit = 20): Promise<CompletedLap[]> {
    await this.queue;
    return this.repository.listLaps(session, carIdx, Math.max(1, Math.min(limit, 200)));
  }

  async listClassGaps(session: SessionState, classId: number, afterLapByCar: ReadonlyMap<number, number> = new Map()): Promise<ClassGapHistoryPoint[]> {
    await this.queue;
    return this.repository.listClassGaps(session, classId, afterLapByCar);
  }

  async listSectors(session: SessionState, carIdx: number, limit = 60): Promise<CompletedSector[]> {
    await this.queue;
    return this.repository.listSectors(session, carIdx, Math.max(1, Math.min(limit, 600)));
  }

  async listSessions(externalSubSessionId?: number): Promise<HistorySessionSummary[]> {
    await this.queue;
    return this.repository.listSessions(externalSubSessionId);
  }

  async reviewSession(historySessionId: string, revision?: string): Promise<CompletedSessionReview | null> {
    await this.queue;
    return this.repository.reviewSession(historySessionId, revision);
  }

  async listSessionSectors(historySessionId: string, carIdx: number, revision?: string, limit = 600): Promise<CompletedSector[] | null> {
    await this.queue;
    return this.repository.listSessionSectors(historySessionId, carIdx, revision, Math.max(1, Math.min(limit, 600)));
  }

  async close(): Promise<void> {
    await this.queue;
    await this.repository.close();
  }

  private isCompleteLap(session: SessionState, driver: DriverState): boolean {
    if (driver.lastLapNumber == null || driver.lastLapNumber <= 0 || driver.lastLap == null || driver.lastLap <= 0) return false;
    if (driver.lastLapPosition == null || driver.lastLapClassPosition == null) return false;
    if (session.type !== "race") return true;
    if (driver.lastLapLapsBehindLeader == null) return false;
    if (driver.lastLapLapsBehindClassLeader == null) return false;
    const hasOverallGap = driver.lastLapLapsBehindLeader > 0 || driver.lastLapGapToLeader != null;
    const hasClassGap = driver.lastLapLapsBehindClassLeader > 0 || driver.lastLapGapToClassLeader != null;
    return hasOverallGap && hasClassGap;
  }

  private queueSessionObservation(session: SessionState, completed: boolean): void {
    const snapshot = structuredClone(session);
    this.queue = this.queue.then(() => this.repository.observeSession(snapshot, completed)).catch(this.onError);
  }

  private queueSectors(session: SessionState, driver: DriverState, entryKey: string): void {
    const definition = session.sectorDefinition;
    if (!definition || !driver.sectors) return;
    const candidates = [...(driver.sectors.previousLap ?? []), ...(driver.sectors.currentLap ?? [])]
      .filter((sector) => sector.definitionRevision === definition.revision)
      .filter((sector) => !this.pending.has(`${entryKey}:sector:${sector.lapNumber}:${sector.sectorNumber}:${sector.definitionRevision}`))
      .filter((sector) => !this.persistedSectors.has(`${entryKey}:sector:${sector.lapNumber}:${sector.sectorNumber}:${sector.definitionRevision}`));
    if (candidates.length === 0) return;
    const keys = candidates.map((sector) => `${entryKey}:sector:${sector.lapNumber}:${sector.sectorNumber}:${sector.definitionRevision}`);
    keys.forEach((key) => this.pending.add(key));
    this.queue = this.queue.then(async () => {
      try {
        await this.repository.recordSectors(session, driver, definition, candidates);
        keys.forEach((key) => this.persistedSectors.add(key));
      } catch (error) {
        this.onError(error);
      } finally {
        keys.forEach((key) => this.pending.delete(key));
      }
    });
  }
}
