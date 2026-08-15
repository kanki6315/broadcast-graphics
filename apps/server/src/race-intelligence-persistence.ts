import type { SessionState } from "@racecontrol/protocol";
import { Pool } from "pg";
import type { RaceIntelligenceCheckpoint } from "./race-intelligence-service.js";
import { RaceIntelligenceService } from "./race-intelligence-service.js";
import type { RaceStateCheckpoint } from "./race-state-projection.js";
import { StateStore } from "./state-store.js";

export interface RaceRecoveryCheckpoint {
  schemaVersion: 2;
  intelligence: RaceIntelligenceCheckpoint;
  raceState: RaceStateCheckpoint | null;
}

export interface RaceIntelligenceCheckpointRepository {
  initialize(): Promise<void>;
  load(session: SessionState): Promise<RaceRecoveryCheckpoint | null>;
  save(session: SessionState, checkpoint: RaceRecoveryCheckpoint): Promise<void>;
  close(): Promise<void>;
}

function sessionKey(session: SessionState): string {
  return `${session.source}:${session.sourceMode}:${session.id}`;
}

function sectorRevision(session: SessionState): string {
  return session.sectorDefinition?.revision ?? "";
}

function checkpointKey(session: SessionState): string {
  return `${sessionKey(session)}:${sectorRevision(session)}`;
}

export class MemoryRaceIntelligenceCheckpointRepository implements RaceIntelligenceCheckpointRepository {
  private readonly checkpoints = new Map<string, RaceRecoveryCheckpoint>();

  async initialize(): Promise<void> {}

  async load(session: SessionState): Promise<RaceRecoveryCheckpoint | null> {
    return structuredClone(this.checkpoints.get(checkpointKey(session)) ?? null);
  }

  async save(session: SessionState, checkpoint: RaceRecoveryCheckpoint): Promise<void> {
    const key = checkpointKey(session);
    this.checkpoints.delete(key);
    this.checkpoints.set(key, structuredClone(checkpoint));
    while (this.checkpoints.size > 8) this.checkpoints.delete(this.checkpoints.keys().next().value!);
  }

  async close(): Promise<void> {}
}

interface CheckpointRow { payload: RaceRecoveryCheckpoint }

export class PostgresRaceIntelligenceCheckpointRepository implements RaceIntelligenceCheckpointRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bg_race_intelligence_checkpoints (
        source text NOT NULL,
        source_mode text NOT NULL,
        source_session_id text NOT NULL,
        schema_version integer NOT NULL,
        sector_revision text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (source, source_mode, source_session_id, sector_revision)
      )
    `);
  }

  async load(session: SessionState): Promise<RaceRecoveryCheckpoint | null> {
    const result = await this.pool.query<CheckpointRow>(`
      SELECT payload FROM bg_race_intelligence_checkpoints
      WHERE source=$1 AND source_mode=$2 AND source_session_id=$3 AND sector_revision=$4 AND schema_version=2
    `, [session.source, session.sourceMode, session.id, sectorRevision(session)]);
    const checkpoint = result.rows[0]?.payload;
    return checkpoint?.schemaVersion === 2 ? checkpoint : null;
  }

  async save(session: SessionState, checkpoint: RaceRecoveryCheckpoint): Promise<void> {
    await this.pool.query(`
      INSERT INTO bg_race_intelligence_checkpoints (
        source, source_mode, source_session_id, schema_version, sector_revision, payload, updated_at
      ) VALUES ($1,$2,$3,2,$4,$5,now())
      ON CONFLICT (source, source_mode, source_session_id, sector_revision) DO UPDATE SET
        schema_version=EXCLUDED.schema_version,
        sector_revision=EXCLUDED.sector_revision,
        payload=EXCLUDED.payload,
        updated_at=EXCLUDED.updated_at
    `, [session.source, session.sourceMode, session.id, sectorRevision(session), checkpoint]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createRaceIntelligenceCheckpointRepository(databaseUrl?: string): RaceIntelligenceCheckpointRepository {
  return databaseUrl
    ? new PostgresRaceIntelligenceCheckpointRepository(databaseUrl)
    : new MemoryRaceIntelligenceCheckpointRepository();
}

function semanticSignature(checkpoint: RaceRecoveryCheckpoint): string {
  return JSON.stringify({
    sessionId: checkpoint.intelligence.sessionId,
    sectorDefinitionRevision: checkpoint.intelligence.sectorDefinitionRevision,
    stints: checkpoint.intelligence.stints.map(({ duration: _, lapCount: __, ...stint }) => stint),
    pitVisits: checkpoint.intelligence.pitVisits.map(({ carIdx, visits }) => ({
      carIdx,
      visits: visits.map(([entry, visit]) => [entry, visit.pitExitTime, visit.pitLap, visit.driverChange, visit.exitDriverId, visit.quality]),
    })),
    raceState: checkpoint.raceState,
  });
}

export class RaceIntelligencePersistence {
  private hydratedKey: string | null = null;
  private hydration: { key: string; promise: Promise<void> } | null = null;
  private lastSignature: string | null = null;
  private nextInspectionAt = Number.NEGATIVE_INFINITY;
  private nextPeriodicWriteAt = Number.NEGATIVE_INFINITY;
  private latest: { session: SessionState; checkpoint: RaceRecoveryCheckpoint } | null = null;
  private pending: { session: SessionState; checkpoint: RaceRecoveryCheckpoint } | null = null;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly repository: RaceIntelligenceCheckpointRepository,
    private readonly intelligence: RaceIntelligenceService,
    private readonly store: StateStore,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly clock: () => number = Date.now,
    private readonly periodicWriteMs = 5_000,
    private readonly inspectionIntervalMs = 1_000,
  ) {}

  async hydrate(session: SessionState): Promise<void> {
    const revision = session.sectorDefinition?.revision ?? "";
    const key = `${sessionKey(session)}:${revision}`;
    if (this.hydratedKey === key) return;
    if (this.hydration?.key === key) return this.hydration.promise;
    this.nextInspectionAt = Number.NEGATIVE_INFINITY;
    this.nextPeriodicWriteAt = Number.NEGATIVE_INFINITY;
    this.lastSignature = null;
    this.latest = null;
    const promise = this.repository.load(session).then((checkpoint) => {
      if (checkpoint?.schemaVersion === 2 && this.intelligence.restore(session, checkpoint.intelligence)) {
        if (checkpoint.raceState?.sessionId === session.id) this.store.restoreRaceState(checkpoint.raceState);
      }
    }).catch(this.onError).finally(() => {
      // Recovery must fail open: live telemetry remains authoritative when the
      // checkpoint store is temporarily unavailable.
      this.hydratedKey = key;
    });
    this.hydration = { key, promise };
    try {
      await promise;
    } finally {
      if (this.hydration?.promise === promise) this.hydration = null;
    }
  }

  observe(session: SessionState): void {
    const now = this.clock();
    if (now < this.nextInspectionAt) return;
    this.nextInspectionAt = now + this.inspectionIntervalMs;
    const intelligence = this.intelligence.checkpoint();
    if (!intelligence) return;
    const checkpoint: RaceRecoveryCheckpoint = {
      schemaVersion: 2,
      intelligence,
      raceState: this.store.raceStateCheckpoint(),
    };
    const latest = { session: structuredClone(session), checkpoint };
    this.latest = latest;
    const signature = semanticSignature(checkpoint);
    if (signature === this.lastSignature && now < this.nextPeriodicWriteAt) return;
    this.lastSignature = signature;
    this.nextPeriodicWriteAt = now + this.periodicWriteMs;
    this.pending = latest;
    this.startWriter();
  }

  private startWriter(): void {
    if (this.writing) return;
    this.writing = this.drain().finally(() => {
      this.writing = null;
      if (this.pending) this.startWriter();
    });
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const next = this.pending;
      this.pending = null;
      try {
        await this.repository.save(next.session, next.checkpoint);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  async close(): Promise<void> {
    if (this.latest) this.pending = this.latest;
    while (this.pending || this.writing) {
      this.startWriter();
      if (this.writing) await this.writing;
    }
    await this.repository.close();
  }
}
