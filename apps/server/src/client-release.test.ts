import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadClientRelease, parseClientReleaseManifest } from "./client-release.js";

const validManifest = {
  version: "0.6.0",
  url: "/api/client/download",
  sha256: "a".repeat(64),
  size: 4,
};

test("parses a valid public client release manifest", () => {
  assert.deepEqual(parseClientReleaseManifest(JSON.stringify(validManifest)), validManifest);
});

test("rejects malformed release metadata", () => {
  assert.throws(() => parseClientReleaseManifest(JSON.stringify({ ...validManifest, sha256: "nope" })), /SHA-256/);
  assert.throws(() => parseClientReleaseManifest(JSON.stringify({ ...validManifest, url: "https://example.com/client.exe" })), /URL/);
  assert.throws(() => parseClientReleaseManifest(JSON.stringify({ ...validManifest, size: 0 })), /size/);
});

test("loads a release only when its executable matches the manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "client-release-"));
  await writeFile(join(root, "latest.json"), JSON.stringify(validManifest));
  await writeFile(join(root, "BroadcastGraphicsClient.exe"), "test");
  assert.deepEqual((await loadClientRelease(root))?.manifest, validManifest);

  await writeFile(join(root, "BroadcastGraphicsClient.exe"), "wrong-size");
  await assert.rejects(() => loadClientRelease(root), /does not match/);
});
