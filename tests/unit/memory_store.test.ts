import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MemoryStore,
  restoreContextCookies,
  saveContextCookies,
} from "../../memory_store";

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
