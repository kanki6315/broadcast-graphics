import { createHash, randomUUID } from "node:crypto";
import type {
  ActiveTrackMap,
  SectorBoundary,
  SectorDefinition,
  SectorDefinitionRevision,
  SessionState,
  TrackConfigurationSnapshot,
  TrackLayoutIdentity,
  TrackMapCalibration,
  TrackMapDefinition,
  TrackMapPathCandidate,
  TrackMapSource,
} from "@racecontrol/protocol";
import { Pool, type PoolClient } from "pg";
import { prepareSvgPath, sanitizeTrackSvg, TrackMapValidationError } from "./track-map-geometry.js";

export const MINIMUM_SECTOR_SPACING = 0.005;

export class TrackConfigurationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}

export interface MapImportPreview {
  checksum: string;
  sanitizedSvg: string;
  viewBox: [number, number, number, number];
  candidates: TrackMapPathCandidate[];
  duplicateMapDefinitionId?: string;
}

export interface TrackConfigurationRepository {
  initialize(): Promise<void>;
  previewImport(svg: string): Promise<MapImportPreview>;
  importMap(input: { svg: string; layout: TrackLayoutIdentity; selectedPathId: string; source?: TrackMapSource; sourceVersion?: string; originalFilename?: string; author?: string }): Promise<TrackMapDefinition>;
  listMaps(layout: TrackLayoutIdentity): Promise<TrackMapDefinition[]>;
  getMap(id: string): Promise<TrackMapDefinition | null>;
  saveCalibration(input: { mapDefinitionId: string; startFinishPathPct: number; direction: "forward" | "reverse"; rotationDegrees?: number; author?: string }): Promise<TrackMapCalibration>;
  activateCalibration(calibrationId: string, layout: TrackLayoutIdentity): Promise<TrackMapCalibration>;
  listCalibrations(mapDefinitionId: string): Promise<TrackMapCalibration[]>;
  observeNativeDefinition(session: SessionState): Promise<void>;
  saveSectorDraft(input: { layout: TrackLayoutIdentity; boundaries: SectorBoundary[]; mapCalibrationId?: string | null; author?: string; sessionId?: string }): Promise<SectorDefinitionRevision>;
  activateSectorRevision(revision: string, layout: TrackLayoutIdentity, session: SessionState | null): Promise<SectorDefinitionRevision>;
  listSectorRevisions(layout: TrackLayoutIdentity): Promise<SectorDefinitionRevision[]>;
  snapshot(layout: TrackLayoutIdentity): Promise<TrackConfigurationSnapshot>;
  close(): Promise<void>;
}

export function normalizeLayout(layout: TrackLayoutIdentity): TrackLayoutIdentity {
  const trackName = layout.trackName?.trim();
  if (!trackName) throw new TrackConfigurationError("Track name is required.", "invalid-layout");
  const finiteOptional = (value: number | null | undefined, name: string) => {
    if (value == null) return value;
    if (!Number.isFinite(value)) throw new TrackConfigurationError(`${name} must be finite.`, "invalid-layout");
    return value;
  };
  return {
    trackId: finiteOptional(layout.trackId, "Track ID"),
    configurationId: finiteOptional(layout.configurationId, "Configuration ID"),
    trackName: trackName.slice(0, 200),
    configurationName: layout.configurationName?.trim().slice(0, 200) || null,
    trackLengthMeters: finiteOptional(layout.trackLengthMeters, "Track length"),
  };
}

export function layoutKey(layout: TrackLayoutIdentity): string {
  const value = normalizeLayout(layout);
  return JSON.stringify([
    value.trackId ?? null,
    value.configurationId ?? null,
    value.trackName.toLocaleLowerCase(),
    value.configurationName?.toLocaleLowerCase() ?? null,
  ]);
}

export function sessionLayout(session: SessionState): TrackLayoutIdentity {
  return { trackId: session.trackId, trackName: session.trackName };
}

export function layoutsMatch(left: TrackLayoutIdentity, right: TrackLayoutIdentity): boolean {
  return layoutKey(left) === layoutKey(right);
}

function raceHasStarted(session: SessionState | null): boolean {
  return Boolean(session?.type === "race" && (
    session.lapsCompleted > 0 || session.lap > 1 || session.startState === "go" || ["racing", "checkered", "cool-down"].includes(session.phase)
  ));
}

export function validateBoundaries(boundaries: SectorBoundary[]): SectorBoundary[] {
  if (boundaries.length < 2) throw new TrackConfigurationError("At least two sector boundaries are required.", "insufficient-boundaries");
  if (boundaries.some((boundary) => !Number.isFinite(boundary.startPct) || boundary.startPct < 0 || boundary.startPct >= 1))
    throw new TrackConfigurationError("Sector percentages must be finite values from zero up to one.", "invalid-boundary");
  const ordered = [...boundaries].sort((a, b) => a.startPct - b.startPct);
  if (Math.abs(ordered[0]!.startPct) > 1e-9) throw new TrackConfigurationError("Sector 1 must begin at the fixed start/finish boundary (0.000%).", "start-finish-fixed");
  for (let index = 1; index < ordered.length; index++) {
    const spacing = ordered[index]!.startPct - ordered[index - 1]!.startPct;
    if (spacing < MINIMUM_SECTOR_SPACING) throw new TrackConfigurationError("Sector boundaries must be at least 0.5% of a lap apart.", "minimum-spacing");
  }
  if (1 - ordered.at(-1)!.startPct < MINIMUM_SECTOR_SPACING) throw new TrackConfigurationError("The final sector must be at least 0.5% of a lap long.", "minimum-spacing");
  return ordered.map((boundary, index) => ({ sectorNumber: index + 1, startPct: boundary.startPct }));
}

function customRevision(layout: TrackLayoutIdentity, boundaries: SectorBoundary[], calibrationId?: string | null): string {
  return `custom-${createHash("sha256").update(JSON.stringify({ layout: normalizeLayout(layout), boundaries, calibrationId: calibrationId ?? null })).digest("hex").slice(0, 16)}`;
}

export class MemoryTrackConfigurationRepository implements TrackConfigurationRepository {
  protected readonly maps = new Map<string, TrackMapDefinition>();
  protected readonly calibrations = new Map<string, TrackMapCalibration>();
  protected readonly sectors = new Map<string, SectorDefinitionRevision>();

  async initialize(): Promise<void> {}

  async previewImport(svg: string): Promise<MapImportPreview> {
    const preview = sanitizeTrackSvg(svg);
    const duplicate = [...this.maps.values()].find((map) => map.sourceChecksum === preview.checksum);
    return { ...preview, duplicateMapDefinitionId: duplicate?.id };
  }

  async importMap(input: { svg: string; layout: TrackLayoutIdentity; selectedPathId: string; source?: TrackMapSource; sourceVersion?: string; originalFilename?: string }): Promise<TrackMapDefinition> {
    const preview = sanitizeTrackSvg(input.svg);
    const layout = normalizeLayout(input.layout);
    const duplicate = [...this.maps.values()].find((map) => map.sourceChecksum === preview.checksum && layoutsMatch(map.layout, layout));
    if (duplicate) return structuredClone(duplicate);
    const selected = preview.candidates.find((candidate) => candidate.id === input.selectedPathId);
    if (!selected) throw new TrackConfigurationError("Select one of the validated centerline paths.", "invalid-centerline");
    prepareSvgPath(selected.pathData);
    const now = new Date().toISOString();
    const map: TrackMapDefinition = {
      id: randomUUID(), layout, source: input.source ?? "imported", sourceChecksum: preview.checksum,
      sourceVersion: input.sourceVersion?.slice(0, 200) ?? null,
      originalFilename: input.originalFilename?.slice(0, 255) ?? null,
      importedAt: now, sanitizationStatus: input.source === "bundled" ? "bundled" : "sanitized",
      sanitizedSvg: preview.sanitizedSvg, centerlinePath: selected.pathData, centerlinePathId: selected.id,
      viewBox: preview.viewBox, createdAt: now,
    };
    this.maps.set(map.id, map);
    return structuredClone(map);
  }

  async listMaps(layout: TrackLayoutIdentity): Promise<TrackMapDefinition[]> {
    return [...this.maps.values()].filter((map) => layoutsMatch(map.layout, layout)).map((map) => structuredClone(map));
  }

  async getMap(id: string): Promise<TrackMapDefinition | null> { return structuredClone(this.maps.get(id) ?? null); }

  async saveCalibration(input: { mapDefinitionId: string; startFinishPathPct: number; direction: "forward" | "reverse"; rotationDegrees?: number; author?: string }): Promise<TrackMapCalibration> {
    const map = this.maps.get(input.mapDefinitionId);
    if (!map) throw new TrackConfigurationError("Track map not found.", "map-not-found", 404);
    if (!Number.isFinite(input.startFinishPathPct) || input.startFinishPathPct < 0 || input.startFinishPathPct >= 1)
      throw new TrackConfigurationError("Start/finish must be a finite position from zero up to one.", "invalid-calibration");
    if (!Number.isFinite(input.rotationDegrees ?? 0) || Math.abs(input.rotationDegrees ?? 0) > 360)
      throw new TrackConfigurationError("Rotation must be between -360 and 360 degrees.", "invalid-calibration");
    const revision = Math.max(0, ...[...this.calibrations.values()].filter((candidate) => candidate.mapDefinitionId === map.id).map((candidate) => candidate.revision)) + 1;
    const calibration: TrackMapCalibration = {
      id: randomUUID(), mapDefinitionId: map.id, revision, startFinishPathPct: input.startFinishPathPct,
      direction: input.direction, rotationDegrees: input.rotationDegrees ?? 0, active: false,
      createdAt: new Date().toISOString(), createdBy: input.author ?? null,
    };
    this.calibrations.set(calibration.id, calibration);
    return structuredClone(calibration);
  }

  async activateCalibration(calibrationId: string, layout: TrackLayoutIdentity): Promise<TrackMapCalibration> {
    const calibration = this.calibrations.get(calibrationId);
    const map = calibration && this.maps.get(calibration.mapDefinitionId);
    if (!calibration || !map) throw new TrackConfigurationError("Calibration not found.", "calibration-not-found", 404);
    if (!layoutsMatch(map.layout, layout)) throw new TrackConfigurationError("This calibration belongs to a different track layout.", "layout-mismatch", 409);
    for (const candidate of this.calibrations.values()) {
      const candidateMap = this.maps.get(candidate.mapDefinitionId);
      if (candidateMap && layoutsMatch(candidateMap.layout, layout)) candidate.active = candidate.id === calibration.id;
    }
    calibration.active = true;
    return structuredClone(calibration);
  }

  async listCalibrations(mapDefinitionId: string): Promise<TrackMapCalibration[]> {
    return [...this.calibrations.values()].filter((candidate) => candidate.mapDefinitionId === mapDefinitionId)
      .sort((a, b) => b.revision - a.revision).map((candidate) => structuredClone(candidate));
  }

  async observeNativeDefinition(session: SessionState): Promise<void> {
    const definition = session.sectorDefinition;
    if (!definition || this.sectors.has(definition.revision)) return;
    const now = new Date().toISOString();
    const reportedLayout = normalizeLayout(definition.layout ?? sessionLayout(session));
    const matchingMaps = [...this.maps.values()].filter((map) =>
      map.layout.trackId === reportedLayout.trackId && map.layout.trackName.toLocaleLowerCase() === reportedLayout.trackName.toLocaleLowerCase());
    // Older clients do not report configuration identity. Reuse it only when a
    // single imported layout is an unambiguous match for this exact track ID.
    const layout = matchingMaps.length === 1 ? matchingMaps[0]!.layout : reportedLayout;
    const activeForLayout = [...this.sectors.values()].some((candidate) => candidate.active && layoutsMatch(candidate.layout!, layout));
    this.sectors.set(definition.revision, {
      ...structuredClone(definition), layout, boundaries: validateBoundaries(definition.boundaries), createdAt: definition.createdAt ?? now,
      active: !activeForLayout, draft: false, locked: raceHasStarted(session), effectiveSessionId: !activeForLayout ? session.id : null,
      effectiveAt: !activeForLayout ? now : null,
    });
  }

  async saveSectorDraft(input: { layout: TrackLayoutIdentity; boundaries: SectorBoundary[]; mapCalibrationId?: string | null; author?: string; sessionId?: string }): Promise<SectorDefinitionRevision> {
    const layout = normalizeLayout(input.layout);
    const boundaries = validateBoundaries(input.boundaries);
    if (input.mapCalibrationId) {
      const calibration = this.calibrations.get(input.mapCalibrationId);
      const map = calibration && this.maps.get(calibration.mapDefinitionId);
      if (!calibration || !map || !layoutsMatch(map.layout, layout)) throw new TrackConfigurationError("The sector draft requires a calibration for the same layout.", "layout-mismatch", 409);
    }
    const revision = customRevision(layout, boundaries, input.mapCalibrationId);
    const existing = this.sectors.get(revision);
    if (existing) return structuredClone(existing);
    const calibration = input.mapCalibrationId ? this.calibrations.get(input.mapCalibrationId) : null;
    const draft: SectorDefinitionRevision = {
      revision, source: "custom", sessionId: input.sessionId ?? "future", trackId: layout.trackId,
      trackName: layout.trackName, layout, boundaries, mapCalibrationId: input.mapCalibrationId ?? null,
      mapCalibrationRevision: calibration?.revision ?? null, createdAt: new Date().toISOString(), createdBy: input.author ?? null,
      active: false, draft: true, locked: false, effectiveSessionId: null, effectiveAt: null,
    };
    this.sectors.set(revision, draft);
    return structuredClone(draft);
  }

  async activateSectorRevision(revision: string, layout: TrackLayoutIdentity, session: SessionState | null): Promise<SectorDefinitionRevision> {
    const selected = this.sectors.get(revision);
    if (!selected) throw new TrackConfigurationError("Sector revision not found.", "revision-not-found", 404);
    if (!layoutsMatch(selected.layout!, layout)) throw new TrackConfigurationError("This sector revision belongs to a different track layout.", "layout-mismatch", 409);
    if (raceHasStarted(session)) throw new TrackConfigurationError("Race timing has started. This draft is saved for a future session and cannot affect the current race.", "definition-locked", 409);
    for (const candidate of this.sectors.values()) {
      if (layoutsMatch(candidate.layout!, layout)) { candidate.active = candidate.revision === revision; candidate.draft = candidate.revision === revision ? false : candidate.draft; }
    }
    selected.active = true; selected.draft = false; selected.effectiveSessionId = session?.id ?? null; selected.effectiveAt = new Date().toISOString();
    return structuredClone(selected);
  }

  async listSectorRevisions(layout: TrackLayoutIdentity): Promise<SectorDefinitionRevision[]> {
    return [...this.sectors.values()].filter((candidate) => layoutsMatch(candidate.layout!, layout))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((candidate) => structuredClone(candidate));
  }

  async snapshot(layout: TrackLayoutIdentity): Promise<TrackConfigurationSnapshot> {
    const normalized = normalizeLayout(layout);
    const activeCalibration = [...this.calibrations.values()].find((calibration) => {
      const map = this.maps.get(calibration.mapDefinitionId);
      return calibration.active && map && layoutsMatch(map.layout, normalized);
    });
    const map = activeCalibration && this.maps.get(activeCalibration.mapDefinitionId);
    const activeDefinition = [...this.sectors.values()].find((definition) => definition.active && layoutsMatch(definition.layout!, normalized));
    const activeMap: ActiveTrackMap | null = activeCalibration && map ? {
      mapDefinitionId: map.id, calibrationId: activeCalibration.id, calibrationRevision: activeCalibration.revision, sourceChecksum: map.sourceChecksum,
    } : null;
    return {
      layout: normalized, activeMap,
      activeSectorDefinition: activeDefinition ? {
        revision: activeDefinition.revision, source: activeDefinition.source, boundaries: structuredClone(activeDefinition.boundaries),
        mapCalibrationId: activeDefinition.mapCalibrationId, mapCalibrationRevision: activeDefinition.mapCalibrationRevision, locked: activeDefinition.locked,
      } : null,
    };
  }

  async close(): Promise<void> {}
}

interface ConfigRow { payload: TrackMapDefinition | TrackMapCalibration | SectorDefinitionRevision }

export class PostgresTrackConfigurationRepository extends MemoryTrackConfigurationRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) { super(); this.pool = new Pool({ connectionString: databaseUrl, max: 3 }); }

  override async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bg_track_map_definitions (
        id uuid PRIMARY KEY, layout_key text NOT NULL, source_checksum char(64) NOT NULL,
        payload jsonb NOT NULL, created_at timestamptz NOT NULL,
        UNIQUE (layout_key, source_checksum)
      );
      CREATE INDEX IF NOT EXISTS bg_track_map_definitions_layout_idx ON bg_track_map_definitions (layout_key, created_at DESC);
      CREATE TABLE IF NOT EXISTS bg_track_map_calibrations (
        id uuid PRIMARY KEY, map_definition_id uuid NOT NULL REFERENCES bg_track_map_definitions(id) ON DELETE RESTRICT,
        layout_key text NOT NULL, revision integer NOT NULL, active boolean NOT NULL DEFAULT false,
        payload jsonb NOT NULL, created_at timestamptz NOT NULL,
        UNIQUE (map_definition_id, revision)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bg_track_map_calibrations_one_active_idx ON bg_track_map_calibrations (layout_key) WHERE active;
      CREATE TABLE IF NOT EXISTS bg_track_sector_revisions (
        revision text PRIMARY KEY, layout_key text NOT NULL, source text NOT NULL CHECK (source IN ('iracing', 'custom')),
        active boolean NOT NULL DEFAULT false, draft boolean NOT NULL DEFAULT true, locked boolean NOT NULL DEFAULT false,
        payload jsonb NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS bg_track_sector_revisions_one_active_idx ON bg_track_sector_revisions (layout_key) WHERE active;
    `);
    const [maps, calibrations, sectors] = await Promise.all([
      this.pool.query<ConfigRow>("SELECT payload FROM bg_track_map_definitions"),
      this.pool.query<ConfigRow>("SELECT payload FROM bg_track_map_calibrations"),
      this.pool.query<ConfigRow>("SELECT payload FROM bg_track_sector_revisions"),
    ]);
    for (const row of maps.rows) this.maps.set((row.payload as TrackMapDefinition).id, row.payload as TrackMapDefinition);
    for (const row of calibrations.rows) this.calibrations.set((row.payload as TrackMapCalibration).id, row.payload as TrackMapCalibration);
    for (const row of sectors.rows) this.sectors.set((row.payload as SectorDefinitionRevision).revision, row.payload as SectorDefinitionRevision);
  }

  override async importMap(input: Parameters<MemoryTrackConfigurationRepository["importMap"]>[0]): Promise<TrackMapDefinition> {
    const map = await super.importMap(input);
    await this.pool.query(`INSERT INTO bg_track_map_definitions (id, layout_key, source_checksum, payload, created_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (layout_key, source_checksum) DO NOTHING`, [map.id, layoutKey(map.layout), map.sourceChecksum, map, map.createdAt]);
    return map;
  }

  override async saveCalibration(input: Parameters<MemoryTrackConfigurationRepository["saveCalibration"]>[0]): Promise<TrackMapCalibration> {
    const calibration = await super.saveCalibration(input);
    const map = this.maps.get(calibration.mapDefinitionId)!;
    await this.pool.query(`INSERT INTO bg_track_map_calibrations (id,map_definition_id,layout_key,revision,active,payload,created_at)
      VALUES ($1,$2,$3,$4,false,$5,$6)`, [calibration.id, calibration.mapDefinitionId, layoutKey(map.layout), calibration.revision, calibration, calibration.createdAt]);
    return calibration;
  }

  override async activateCalibration(calibrationId: string, layout: TrackLayoutIdentity): Promise<TrackMapCalibration> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const calibration = await super.activateCalibration(calibrationId, layout);
      const key = layoutKey(layout);
      await client.query("UPDATE bg_track_map_calibrations SET active=false, payload=jsonb_set(payload, '{active}', 'false') WHERE layout_key=$1", [key]);
      await client.query("UPDATE bg_track_map_calibrations SET active=true, payload=$2 WHERE id=$1", [calibration.id, calibration]);
      await client.query("COMMIT");
      return calibration;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async persistSector(definition: SectorDefinitionRevision, client: Pool | PoolClient = this.pool): Promise<void> {
    await client.query(`INSERT INTO bg_track_sector_revisions (revision,layout_key,source,active,draft,locked,payload,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (revision) DO UPDATE SET active=EXCLUDED.active,draft=EXCLUDED.draft,locked=EXCLUDED.locked,payload=EXCLUDED.payload`,
      [definition.revision, layoutKey(definition.layout!), definition.source, definition.active, definition.draft, definition.locked, definition, definition.createdAt]);
  }

  override async observeNativeDefinition(session: SessionState): Promise<void> {
    await super.observeNativeDefinition(session);
    if (session.sectorDefinition) await this.persistSector(this.sectors.get(session.sectorDefinition.revision)!);
  }

  override async saveSectorDraft(input: Parameters<MemoryTrackConfigurationRepository["saveSectorDraft"]>[0]): Promise<SectorDefinitionRevision> {
    const draft = await super.saveSectorDraft(input); await this.persistSector(draft); return draft;
  }

  override async activateSectorRevision(revision: string, layout: TrackLayoutIdentity, session: SessionState | null): Promise<SectorDefinitionRevision> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await super.activateSectorRevision(revision, layout, session);
      const key = layoutKey(layout);
      await client.query("UPDATE bg_track_sector_revisions SET active=false,payload=jsonb_set(payload, '{active}', 'false') WHERE layout_key=$1", [key]);
      await this.persistSector(selected, client);
      await client.query("COMMIT"); return selected;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  override async close(): Promise<void> { await this.pool.end(); }
}

export function createTrackConfigurationRepository(databaseUrl?: string): TrackConfigurationRepository {
  return databaseUrl ? new PostgresTrackConfigurationRepository(databaseUrl) : new MemoryTrackConfigurationRepository();
}

export function configurationError(error: unknown): TrackConfigurationError | TrackMapValidationError {
  return error instanceof TrackConfigurationError || error instanceof TrackMapValidationError
    ? error : new TrackConfigurationError("Track configuration could not be saved.", "configuration-error", 500);
}
