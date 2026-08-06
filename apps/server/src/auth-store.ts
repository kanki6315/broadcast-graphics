import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccessKey, AccessKeyKind, CreatedAccessKey } from "@racecontrol/protocol";
import { Pool } from "pg";

interface StoredAccessKey extends AccessKey {
  hash: string;
}

interface StoredAuthData {
  version: 1;
  keys: StoredAccessKey[];
}

interface AdminSession {
  username: string;
  expiresAt: number;
}

interface AccessKeyRow {
  id: string;
  kind: AccessKeyKind;
  label: string;
  prefix: string;
  created_at: Date;
  revoked_at: Date | null;
  secret_hash: string;
}

interface SessionRow {
  username: string;
  expires_at: Date;
}

export interface AuthenticationStore {
  initialize(): Promise<void>;
  authenticateAdmin(username: string, password: string): boolean;
  createSession(): Promise<string>;
  validateSession(token: string | undefined): Promise<{ username: string } | null>;
  revokeSession(token: string | undefined): Promise<void>;
  listKeys(): Promise<AccessKey[]>;
  createKey(kind: AccessKeyKind, label: string): Promise<CreatedAccessKey>;
  revokeKey(id: string): Promise<boolean>;
  validateAccessKey(kind: AccessKeyKind, secret: string | undefined): Promise<boolean>;
  close(): Promise<void>;
}

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const PASSWORD_SALT = "broadcast-graphics-admin-v1";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function digestHex(value: string): string {
  return digest(value).toString("hex");
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function accessKey(kind: AccessKeyKind, label: string): { stored: StoredAccessKey; created: CreatedAccessKey } {
  const marker = kind === "ingestion" ? "ing" : "view";
  const secret = `bg_${marker}_${randomBytes(32).toString("base64url")}`;
  const stored: StoredAccessKey = {
    id: randomUUID(),
    kind,
    label,
    prefix: secret.slice(0, 15),
    createdAt: new Date().toISOString(),
    revokedAt: null,
    hash: digestHex(secret),
  };
  const { hash: _hash, ...key } = stored;
  return { stored, created: { key, secret } };
}

abstract class AdminCredentials {
  private readonly adminPasswordDigest: Buffer;

  protected constructor(
    protected readonly adminUsername: string,
    adminPassword: string,
  ) {
    this.adminPasswordDigest = scryptSync(adminPassword, PASSWORD_SALT, 64);
  }

  authenticateAdmin(username: string, password: string): boolean {
    const usernameMatches = constantTimeEqual(digest(username), digest(this.adminUsername));
    const passwordMatches = constantTimeEqual(
      scryptSync(password, PASSWORD_SALT, 64),
      this.adminPasswordDigest,
    );
    return usernameMatches && passwordMatches;
  }
}

export class AuthStore extends AdminCredentials implements AuthenticationStore {
  private data: StoredAuthData = { version: 1, keys: [] };
  private readonly sessions = new Map<string, AdminSession>();

  constructor(
    private readonly dataPath: string,
    adminUsername: string,
    adminPassword: string,
  ) {
    super(adminUsername, adminPassword);
  }

  async initialize(): Promise<void> {
    try {
      const raw = await readFile(this.dataPath, "utf8");
      const parsed = JSON.parse(raw) as StoredAuthData;
      if (parsed.version !== 1 || !Array.isArray(parsed.keys)) throw new Error("Unsupported authentication data format.");
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async createSession(): Promise<string> {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(digestHex(token), {
      username: this.adminUsername,
      expiresAt: now + SESSION_LIFETIME_MS,
    });
    return token;
  }

  async validateSession(token: string | undefined): Promise<{ username: string } | null> {
    if (!token) return null;
    const key = digestHex(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { username: session.username };
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (token) this.sessions.delete(digestHex(token));
  }

  async listKeys(): Promise<AccessKey[]> {
    return this.data.keys.map(({ hash: _hash, ...key }) => key);
  }

  async createKey(kind: AccessKeyKind, label: string): Promise<CreatedAccessKey> {
    const generated = accessKey(kind, label);
    this.data.keys.push(generated.stored);
    await this.persist();
    return generated.created;
  }

  async revokeKey(id: string): Promise<boolean> {
    const key = this.data.keys.find((candidate) => candidate.id === id);
    if (!key || key.revokedAt) return false;
    key.revokedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  async validateAccessKey(kind: AccessKeyKind, secret: string | undefined): Promise<boolean> {
    if (!secret) return false;
    const candidate = digest(secret);
    return this.data.keys.some((key) =>
      key.kind === kind && key.revokedAt === null && constantTimeEqual(Buffer.from(key.hash, "hex"), candidate));
  }

  async close(): Promise<void> {}

  private async persist(): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const temporaryPath = `${this.dataPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.dataPath);
  }
}

export class PostgresAuthStore extends AdminCredentials implements AuthenticationStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string, adminUsername: string, adminPassword: string) {
    super(adminUsername, adminPassword);
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bg_access_keys (
        id uuid PRIMARY KEY,
        kind text NOT NULL CHECK (kind IN ('ingestion', 'view')),
        label text NOT NULL,
        prefix text NOT NULL,
        secret_hash char(64) NOT NULL UNIQUE,
        created_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS bg_access_keys_active_kind_idx
        ON bg_access_keys (kind) WHERE revoked_at IS NULL;
      CREATE TABLE IF NOT EXISTS bg_admin_sessions (
        token_hash char(64) PRIMARY KEY,
        username text NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bg_admin_sessions_expires_at_idx
        ON bg_admin_sessions (expires_at);
    `);
  }

  async createSession(): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.pool.query("DELETE FROM bg_admin_sessions WHERE expires_at <= now()");
    await this.pool.query(
      "INSERT INTO bg_admin_sessions (token_hash, username, expires_at) VALUES ($1, $2, $3)",
      [digestHex(token), this.adminUsername, expiresAt],
    );
    return token;
  }

  async validateSession(token: string | undefined): Promise<{ username: string } | null> {
    if (!token) return null;
    const result = await this.pool.query<SessionRow>(
      "SELECT username, expires_at FROM bg_admin_sessions WHERE token_hash = $1 AND expires_at > now()",
      [digestHex(token)],
    );
    return result.rows[0] ? { username: result.rows[0].username } : null;
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (token) await this.pool.query("DELETE FROM bg_admin_sessions WHERE token_hash = $1", [digestHex(token)]);
  }

  async listKeys(): Promise<AccessKey[]> {
    const result = await this.pool.query<AccessKeyRow>(`
      SELECT id, kind, label, prefix, created_at, revoked_at, secret_hash
      FROM bg_access_keys
      ORDER BY created_at DESC
    `);
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      prefix: row.prefix,
      createdAt: row.created_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    }));
  }

  async createKey(kind: AccessKeyKind, label: string): Promise<CreatedAccessKey> {
    const generated = accessKey(kind, label);
    const key = generated.stored;
    await this.pool.query(
      `INSERT INTO bg_access_keys (id, kind, label, prefix, secret_hash, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [key.id, key.kind, key.label, key.prefix, key.hash, key.createdAt, key.revokedAt],
    );
    return generated.created;
  }

  async revokeKey(id: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE bg_access_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
      [id],
    );
    return result.rowCount === 1;
  }

  async validateAccessKey(kind: AccessKeyKind, secret: string | undefined): Promise<boolean> {
    if (!secret) return false;
    const result = await this.pool.query(
      "SELECT 1 FROM bg_access_keys WHERE kind = $1 AND secret_hash = $2 AND revoked_at IS NULL LIMIT 1",
      [kind, digestHex(secret)],
    );
    return result.rowCount === 1;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createAuthenticationStore(options: {
  databaseUrl?: string;
  dataPath: string;
  adminUsername: string;
  adminPassword: string;
  production: boolean;
}): AuthenticationStore {
  if (options.databaseUrl) {
    return new PostgresAuthStore(options.databaseUrl, options.adminUsername, options.adminPassword);
  }
  if (options.production) throw new Error("DATABASE_URL is required in production.");
  return new AuthStore(options.dataPath, options.adminUsername, options.adminPassword);
}
