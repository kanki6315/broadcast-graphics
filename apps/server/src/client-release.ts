import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface ClientReleaseManifest {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

export interface ClientRelease {
  manifest: ClientReleaseManifest;
  executablePath: string;
}

const sha256Pattern = /^[0-9a-f]{64}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:\.\d+)?$/;

export function parseClientReleaseManifest(raw: string): ClientReleaseManifest {
  const value = JSON.parse(raw) as Partial<ClientReleaseManifest>;
  if (!value || typeof value !== "object") throw new Error("Client release manifest must be an object.");
  if (typeof value.version !== "string" || !versionPattern.test(value.version)) throw new Error("Client release version is invalid.");
  if (value.url !== "/api/client/download") throw new Error("Client release URL is invalid.");
  if (typeof value.sha256 !== "string" || !sha256Pattern.test(value.sha256)) throw new Error("Client release SHA-256 is invalid.");
  if (!Number.isSafeInteger(value.size) || value.size! <= 0) throw new Error("Client release size is invalid.");
  return value as ClientReleaseManifest;
}

export async function loadClientRelease(root: string): Promise<ClientRelease | null> {
  const manifestPath = resolve(root, "latest.json");
  const executablePath = resolve(root, "BroadcastGraphicsClient.exe");
  if (!existsSync(manifestPath) || !existsSync(executablePath)) return null;

  const manifest = parseClientReleaseManifest(await readFile(manifestPath, "utf8"));
  const executable = await stat(executablePath);
  if (!executable.isFile() || executable.size !== manifest.size) {
    throw new Error("Client release executable does not match its manifest size.");
  }
  return { manifest, executablePath };
}

export function streamClientRelease(release: ClientRelease) {
  return createReadStream(release.executablePath);
}
