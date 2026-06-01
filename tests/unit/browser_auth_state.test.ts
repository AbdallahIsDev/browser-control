import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Set up test data home before imports
const testHome = path.join(os.tmpdir(), `bc-test-auth-${Date.now()}`);
process.env.BROWSER_CONTROL_HOME = testHome;

import { MemoryStore } from "../../src/memory_store";
import {
  saveAuthSnapshotToStore,
  loadAuthSnapshot,
  deleteAuthSnapshot,
  listAuthSnapshots,
  exportAuthSnapshot,
  importAuthSnapshot,
  normalizeAuthSnapshot,
  type AuthSnapshot,
} from "../../src/browser/auth_state";

describe("browser_auth_state", () => {
  let store: MemoryStore;

  beforeEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
    fs.mkdirSync(testHome, { recursive: true });
    store = new MemoryStore({ filename: ":memory:" });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  function createTestSnapshot(profileId: string = "test-profile"): AuthSnapshot {
    return {
      profileId,
      cookies: [
        {
          name: "session_id",
          value: "abc123",
          domain: ".example.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          name: "pref",
          value: "dark-mode",
          domain: ".example.com",
          path: "/",
          httpOnly: false,
          secure: false,
          sameSite: "None",
        },
      ],
      localStorage: {
        "https://example.com": {
          "user_token": "jwt-token-here",
          "theme": "dark",
        },
      },
      sessionStorage: {},
      capturedAt: new Date().toISOString(),
      label: "test snapshot",
    };
  }

  describe("saveAuthSnapshotToStore", () => {
    it("should save a snapshot to memory store", () => {
      const snapshot = createTestSnapshot();
      saveAuthSnapshotToStore(store, "test-profile", snapshot);
      const loaded = loadAuthSnapshot(store, "test-profile");
      assert.ok(loaded);
      assert.equal(loaded.profileId, "test-profile");
      assert.equal(loaded.cookies.length, 2);
    });

    it("should save with TTL", () => {
      const snapshot = createTestSnapshot();
      saveAuthSnapshotToStore(store, "ttl-profile", snapshot, 1000);
      const loaded = loadAuthSnapshot(store, "ttl-profile");
      assert.ok(loaded);
    });

    it("does not persist cookie or storage values in plaintext SQLite rows", () => {
      const dbPath = path.join(testHome, "auth-snapshot.sqlite");
      const fileStore = new MemoryStore({ filename: dbPath });
      const snapshot = createTestSnapshot("encrypted-profile");
      snapshot.cookies[0].value = "cookie-marker-secret";
      snapshot.localStorage["https://example.com"]["user_token"] = "local-marker-secret";
      snapshot.sessionStorage = {
        "https://example.com": {
          csrf: "session-marker-secret",
        },
      };

      try {
        saveAuthSnapshotToStore(fileStore, "encrypted-profile", snapshot);
        const loaded = loadAuthSnapshot(fileStore, "encrypted-profile");
        assert.equal(loaded?.cookies[0].value, "cookie-marker-secret");
        assert.equal(loaded?.localStorage["https://example.com"]["user_token"], "local-marker-secret");
        assert.equal(loaded?.sessionStorage["https://example.com"].csrf, "session-marker-secret");
      } finally {
        fileStore.close();
      }

      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = db.prepare("SELECT value_json FROM memory_store WHERE key = ?")
          .get("auth_snapshot:encrypted-profile") as { value_json: string };
        assert.ok(row);
        assert.doesNotMatch(row.value_json, /cookie-marker-secret/);
        assert.doesNotMatch(row.value_json, /local-marker-secret/);
        assert.doesNotMatch(row.value_json, /session-marker-secret/);
      } finally {
        db.close();
      }
    });
  });

  describe("loadAuthSnapshot", () => {
    it("should load a previously saved snapshot", () => {
      const snapshot = createTestSnapshot("load-test");
      saveAuthSnapshotToStore(store, "load-test", snapshot);
      const loaded = loadAuthSnapshot(store, "load-test");
      assert.ok(loaded);
      assert.equal(loaded.profileId, "load-test");
      assert.equal(loaded.cookies.length, 2);
      assert.equal(loaded.cookies[0].name, "session_id");
    });

    it("should return null for nonexistent profile", () => {
      const loaded = loadAuthSnapshot(store, "nonexistent");
      assert.equal(loaded, null);
    });

    it("should preserve localStorage data", () => {
      const snapshot = createTestSnapshot("storage-test");
      saveAuthSnapshotToStore(store, "storage-test", snapshot);
      const loaded = loadAuthSnapshot(store, "storage-test");
      assert.ok(loaded);
      assert.ok(loaded.localStorage["https://example.com"]);
      assert.equal(loaded.localStorage["https://example.com"]["theme"], "dark");
    });

    it("rejects raw unprotected snapshots injected into the store", () => {
      const injected = createTestSnapshot("injected-profile");
      injected.cookies[0].value = "attacker-cookie";
      store.set("auth_snapshot:injected-profile", injected);

      const loaded = loadAuthSnapshot(store, "injected-profile");

      assert.equal(loaded, null);
    });

    it("rejects tampered protected auth snapshot payloads", () => {
      const snapshot = createTestSnapshot("tampered-profile");
      saveAuthSnapshotToStore(store, "tampered-profile", snapshot);
      const stored = store.get<{ encryptedPayload: string }>("auth_snapshot:tampered-profile");
      assert.ok(stored);
      store.set("auth_snapshot:tampered-profile", {
        ...stored,
        encryptedPayload: `${stored.encryptedPayload.slice(0, -4)}AAAA`,
      });

      const loaded = loadAuthSnapshot(store, "tampered-profile");

      assert.equal(loaded, null);
    });
  });

  describe("deleteAuthSnapshot", () => {
    it("should delete a saved snapshot", () => {
      const snapshot = createTestSnapshot("delete-me");
      saveAuthSnapshotToStore(store, "delete-me", snapshot);
      assert.ok(loadAuthSnapshot(store, "delete-me"));
      deleteAuthSnapshot(store, "delete-me");
      assert.equal(loadAuthSnapshot(store, "delete-me"), null);
    });

    it("should not throw when deleting nonexistent snapshot", () => {
      assert.doesNotThrow(() => deleteAuthSnapshot(store, "nope"));
    });
  });

  describe("listAuthSnapshots", () => {
    it("should list all profile IDs with snapshots", () => {
      saveAuthSnapshotToStore(store, "profile-a", createTestSnapshot("profile-a"));
      saveAuthSnapshotToStore(store, "profile-b", createTestSnapshot("profile-b"));
      const ids = listAuthSnapshots(store);
      assert.ok(ids.includes("profile-a"));
      assert.ok(ids.includes("profile-b"));
    });

    it("should return empty array when no snapshots exist", () => {
      const ids = listAuthSnapshots(store);
      assert.equal(ids.length, 0);
    });
  });

  describe("AuthSnapshot structure", () => {
    it("should have required fields", () => {
      const snapshot = createTestSnapshot();
      assert.ok(snapshot.profileId);
      assert.ok(Array.isArray(snapshot.cookies));
      assert.ok(typeof snapshot.localStorage === "object");
      assert.ok(typeof snapshot.sessionStorage === "object");
      assert.ok(snapshot.capturedAt);
    });

    it("cookies should have proper shape", () => {
      const snapshot = createTestSnapshot();
      const cookie = snapshot.cookies[0];
      assert.ok(cookie.name);
      assert.ok(cookie.value);
      assert.ok(cookie.domain);
    });
  });

  describe("Playwright storageState compatibility", () => {
    it("exports Playwright storageState with IndexedDB enabled and legacy fields populated", async () => {
      const calls: unknown[] = [];
      const context = {
        storageState: async (options?: unknown) => {
          calls.push(options);
          return {
            cookies: [{ name: "sid", value: "1", domain: "example.com", path: "/" }],
            origins: [
              {
                origin: "https://example.com",
                localStorage: [{ name: "theme", value: "dark" }],
                indexedDB: [{ name: "db" }],
              },
            ],
          };
        },
        pages: () => [],
      };

      const snapshot = await exportAuthSnapshot(context as never, "p1");

      assert.deepEqual(calls[0], { indexedDB: true });
      assert.equal(snapshot.formatVersion, 2);
      assert.equal(snapshot.storageState?.origins[0].origin, "https://example.com");
      assert.equal(snapshot.localStorage["https://example.com"].theme, "dark");
      assert.equal(snapshot.cookies[0].name, "sid");
    });

    it("falls back when IndexedDB storageState is unavailable", async () => {
      const calls: unknown[] = [];
      const context = {
        storageState: async (options?: unknown) => {
          calls.push(options);
          if (options) throw new Error("indexedDB unsupported");
          return {
            cookies: [],
            origins: [{ origin: "https://example.com", localStorage: [] }],
          };
        },
        pages: () => [],
      };

      const snapshot = await exportAuthSnapshot(context as never, "p1");

      assert.deepEqual(calls, [{ indexedDB: true }, undefined]);
      assert.deepEqual(snapshot.storageState?.cookies, []);
    });

    it("normalizes old snapshots into storageState shape", () => {
      const legacy = createTestSnapshot("legacy");
      const normalized = normalizeAuthSnapshot(legacy);

      assert.equal(normalized.formatVersion, 2);
      assert.equal(normalized.storageState?.cookies.length, legacy.cookies.length);
      assert.equal(normalized.storageState?.origins[0].origin, "https://example.com");
      assert.equal(normalized.storageState?.origins[0].localStorage[0].name, "user_token");
    });

    it("imports cookies and installs localStorage init scripts from storageState", async () => {
      const addedCookies: unknown[] = [];
      const initScripts: unknown[] = [];
      const context = {
        addCookies: async (cookies: unknown[]) => addedCookies.push(...cookies),
        addInitScript: async (_fn: unknown, arg: unknown) => initScripts.push(arg),
        pages: () => [],
      };
      const snapshot: AuthSnapshot = {
        profileId: "p1",
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        capturedAt: new Date().toISOString(),
        storageState: {
          cookies: [{ name: "sid", value: "1", domain: "example.com", path: "/" }],
          origins: [
            {
              origin: "https://example.com",
              localStorage: [{ name: "theme", value: "dark" }],
            },
          ],
        },
      };

      await importAuthSnapshot(context as never, snapshot);

      assert.equal(addedCookies.length, 1);
      assert.deepEqual(initScripts[0], {
        expectedOrigin: "https://example.com",
        entries: { theme: "dark" },
      });
    });

    it("handles missing and empty auth snapshots", async () => {
      const context = {
        addCookies: async () => assert.fail("should not add empty cookies"),
        addInitScript: async () => assert.fail("should not install empty storage"),
        pages: () => [],
      };
      await importAuthSnapshot(context as never, {
        profileId: "empty",
        cookies: [],
        localStorage: {},
        sessionStorage: {},
        capturedAt: new Date().toISOString(),
      });
    });
  });
});
