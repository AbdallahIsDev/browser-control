import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Set up test data home before imports
const testHome = path.join(os.tmpdir(), `bc-test-auth-${Date.now()}`);
process.env.BROWSER_CONTROL_HOME = testHome;

import { MemoryStore } from "../../src/memory_store";
import {
  saveAuthSnapshotToStore,
  loadAuthSnapshot,
  deleteAuthSnapshot,
  listAuthSnapshots,
  type AuthSnapshot,
  type CookieRecord,
} from "../../src/browser_auth_state";

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
      const loaded = store.get<AuthSnapshot>("auth_snapshot:test-profile");
      assert.ok(loaded);
      assert.equal(loaded.profileId, "test-profile");
      assert.equal(loaded.cookies.length, 2);
    });

    it("should save with TTL", () => {
      const snapshot = createTestSnapshot();
      saveAuthSnapshotToStore(store, "ttl-profile", snapshot, 1000);
      const loaded = store.get<AuthSnapshot>("auth_snapshot:ttl-profile");
      assert.ok(loaded);
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
});
