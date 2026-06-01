import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MemoryStore,
  restoreContextCookies,
  saveContextCookies,
} from "../../src/memory_store";

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}

function countRawRows(databasePath: string): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM memory_store").get() as {
      count: number;
    };
    return row.count;
  } finally {
    db.close();
  }
}

function readUserVersion(databasePath: string): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    return row.user_version;
  } finally {
    db.close();
  }
}

test("MemoryStore supports CRUD, TTL, prefix keys, and clear", () => {
  let now = 1_000;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-test-"));
  const databasePath = path.join(tempDir, "memory.sqlite");

  try {
    const store = new MemoryStore({
      filename: databasePath,
      now: () => now,
    });

    store.set("sessions:site-a", { token: "abc" });
    store.set("task_state:job-1", { step: "publish" }, 500);

    assert.deepEqual(store.get("sessions:site-a"), { token: "abc" });
    assert.deepEqual(store.keys("task_state:"), ["task_state:job-1"]);

    now += 1_000;

    assert.equal(store.get("task_state:job-1"), null);

    store.delete("sessions:site-a");
    assert.equal(store.get("sessions:site-a"), null);

    store.set("captcha_stats:site-a", { solves: 1 });
    store.clear();
    assert.deepEqual(store.keys(), []);
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MemoryStore reports stats and collection counts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-stats-"));
  const databasePath = path.join(tempDir, "memory.sqlite");

  try {
    const store = new MemoryStore({
      filename: databasePath,
    });

    store.set("sessions:site-a", { token: "abc" });
    store.set("extracted_data:site-a", { rows: 2 });

    const stats = store.getStats();

    assert.equal(stats.totalKeys, 2);
    assert.equal(stats.collections.sessions, 1);
    assert.equal(stats.collections.extracted_data, 1);
    assert.equal(stats.filename, databasePath);
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MemoryStore migrates legacy v0 databases without losing rows", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-migration-"));
  const databasePath = path.join(tempDir, "memory.sqlite");

  try {
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE memory_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO memory_store (key, value_json, expires_at, updated_at)
      VALUES ('sessions:legacy', '{"token":"kept"}', NULL, 1);
      PRAGMA user_version = 0;
    `);
    db.close();

    const store = new MemoryStore({ filename: databasePath });
    assert.deepEqual(store.get("sessions:legacy"), { token: "kept" });
    store.close();

    assert.equal(readUserVersion(databasePath), 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MemoryStore proactively prunes expired file-backed keys", async () => {
  let now = 1_000;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-prune-"));
  const databasePath = path.join(tempDir, "memory.sqlite");
  let store: MemoryStore | undefined;

  try {
    store = new MemoryStore({
      filename: databasePath,
      now: () => now,
      expiredKeyCleanupIntervalMs: 10,
    });

    store.set("ttl:expired", { stale: true }, 5);
    store.set("ttl:kept", { stale: false }, 60_000);
    assert.equal(countRawRows(databasePath), 2);

    now += 20;
    await waitFor(() => countRawRows(databasePath) === 1);

    assert.deepEqual(store.get("ttl:kept"), { stale: false });
  } finally {
    store?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveContextCookies and restoreContextCookies round-trip cookies through the sessions collection", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-store-cookies-"));
  const databasePath = path.join(tempDir, "memory.sqlite");

  try {
    const store = new MemoryStore({
      filename: databasePath,
    });

    const savedCookies = [
      {
        name: "session",
        value: "cookie-123",
        domain: ".example.com",
        path: "/",
      },
    ];

    const savingContext = {
      cookies: async () => savedCookies,
    };

    await saveContextCookies(store, "site-a", savingContext, 60_000);

    let restoredCookies: unknown[] = [];
    const restoringContext = {
      addCookies: async (cookies: unknown[]) => {
        restoredCookies = cookies;
      },
    };

    const restored = await restoreContextCookies(store, "site-a", restoringContext);

    assert.equal(restored, true);
    assert.deepEqual(restoredCookies, savedCookies);
    store.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
