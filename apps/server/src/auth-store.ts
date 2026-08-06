import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccessKey, AccessKeyKind, CreatedAccessKey } from "@racecontrol/protocol";

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

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AuthStore {
  private data: StoredAuthData = { version: 1, keys: [] };
  private readonly sessions = new Map<string, AdminSession>();
  private readonly adminPasswordDigest: Buffer;

  constructor(
    private readonly dataPath: string,
    private readonly adminUsername: string,
    adminPassword: string,
  ) {
    this.adminPasswordDigest = scryptSync(adminPassword, "broadcast-graphics-admin-v1", 64);
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

  authenticateAdmin(username: string, password: string): boolean {
    const usernameMatches = constantTimeEqual(digest(username), digest(this.adminUsername));
    const passwordMatches = constantTimeEqual(
      scryptSync(password, "broadcast-graphics-admin-v1", 64),
      this.adminPasswordDigest,
    );
    return usernameMatches && passwordMatches;
  }

  createSession(): string {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(digest(token).toString("hex"), {
      username: this.adminUsername,
      expiresAt: now + SESSION_LIFETIME_MS,
    });
    return token;
  }

  validateSession(token: string | undefined): { username: string } | null {
    if (!token) return null;
    const key = digest(token).toString("hex");
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { username: session.username };
  }

  revokeSession(token: string | undefined): void {
    if (token) this.sessions.delete(digest(token).toString("hex"));
  }

  listKeys(): AccessKey[] {
    return this.data.keys.map(({ hash: _hash, ...key }) => key);
  }

  async createKey(kind: AccessKeyKind, label: string): Promise<CreatedAccessKey> {
    const marker = kind === "ingestion" ? "ing" : "view";
    const secret = `bg_${marker}_${randomBytes(32).toString("base64url")}`;
    const key: StoredAccessKey = {
      id: randomUUID(),
      kind,
      label,
      prefix: secret.slice(0, 15),
      createdAt: new Date().toISOString(),
      revokedAt: null,
      hash: digest(secret).toString("hex"),
    };
    this.data.keys.push(key);
    await this.persist();
    const { hash: _hash, ...publicKey } = key;
    return { key: publicKey, secret };
  }

  async revokeKey(id: string): Promise<boolean> {
    const key = this.data.keys.find((candidate) => candidate.id === id);
    if (!key || key.revokedAt) return false;
    key.revokedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  validateAccessKey(kind: AccessKeyKind, secret: string | undefined): boolean {
    if (!secret) return false;
    const candidate = digest(secret);
    return this.data.keys.some((key) =>
      key.kind === kind && key.revokedAt === null && constantTimeEqual(Buffer.from(key.hash, "hex"), candidate));
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const temporaryPath = `${this.dataPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.dataPath);
  }
}
