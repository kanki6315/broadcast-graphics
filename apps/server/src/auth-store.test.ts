import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { AuthStore } from "./auth-store.js";

test("admin sessions can be created and revoked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "broadcast-graphics-auth-"));
  try {
    const store = new AuthStore(join(directory, "auth.json"), "admin", "correct horse battery staple");
    await store.initialize();
    assert.equal(store.authenticateAdmin("admin", "wrong"), false);
    assert.equal(store.authenticateAdmin("admin", "correct horse battery staple"), true);
    const session = store.createSession();
    assert.deepEqual(store.validateSession(session), { username: "admin" });
    store.revokeSession(session);
    assert.equal(store.validateSession(session), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("access keys are only valid for their scope until revoked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "broadcast-graphics-auth-"));
  try {
    const path = join(directory, "auth.json");
    const store = new AuthStore(path, "admin", "password");
    await store.initialize();
    const created = await store.createKey("ingestion", "Race PC");
    assert.equal(store.validateAccessKey("ingestion", created.secret), true);
    assert.equal(store.validateAccessKey("view", created.secret), false);
    assert.equal(store.listKeys()[0]?.prefix, created.key.prefix);
    assert.equal("secret" in store.listKeys()[0]!, false);

    const reloaded = new AuthStore(path, "admin", "password");
    await reloaded.initialize();
    assert.equal(reloaded.validateAccessKey("ingestion", created.secret), true);
    assert.equal(await reloaded.revokeKey(created.key.id), true);
    assert.equal(reloaded.validateAccessKey("ingestion", created.secret), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
