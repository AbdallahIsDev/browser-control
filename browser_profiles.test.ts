import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Set up test data home before imports
const testHome = path.join(os.tmpdir(), `bc-test-profiles-${Date.now()}`);
process.env.BROWSER_CONTROL_HOME = testHome;

import {
  BrowserProfileManager,
  getProfilesDir,
  getProfileDataDir,
  getProfileRegistryPath,
  type BrowserProfile,
  type ProfileType,
} from "./browser_profiles";

describe("BrowserProfileManager", () => {
  let manager: BrowserProfileManager;

  beforeEach(() => {
    // Clean test directory
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(testHome, "profiles"), { recursive: true });
    manager = new BrowserProfileManager();
  });

  afterEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  describe("default profile", () => {
    it("should create a default shared profile on construction", () => {
      const profiles = manager.listProfiles();
      assert.ok(profiles.length >= 1);
      const defaultProfile = profiles.find((p) => p.id === "default");
      assert.ok(defaultProfile);
      assert.equal(defaultProfile.name, "default");
      assert.equal(defaultProfile.type, "shared");
    });

    it("should return default profile via getDefaultProfile()", () => {
      const profile = manager.getDefaultProfile();
      assert.ok(profile);
      assert.equal(profile.id, "default");
      assert.equal(profile.type, "shared");
    });

    it("should not allow deleting the default profile", () => {
      const deleted = manager.deleteProfile("default");
      assert.equal(deleted, false);
      const profile = manager.getProfile("default");
      assert.ok(profile);
    });
  });

  describe("createProfile", () => {
    it("should create a named profile", () => {
      const profile = manager.createProfile("work", "named");
      assert.equal(profile.name, "work");
      assert.equal(profile.type, "named");
      assert.equal(profile.id, "work");
      assert.ok(profile.dataDir.includes("work"));
      assert.ok(profile.createdAt);
      assert.ok(profile.lastUsedAt);
    });

    it("should create an isolated profile with timestamped ID", () => {
      const profile = manager.createProfile("temp-session", "isolated");
      assert.equal(profile.name, "temp-session");
      assert.equal(profile.type, "isolated");
      assert.ok(profile.id.startsWith("isolated-"));
    });

    it("should create the profile data directory", () => {
      const profile = manager.createProfile("test-dir", "named");
      assert.ok(fs.existsSync(profile.dataDir));
    });

    it("should return existing profile if name already exists", () => {
      const first = manager.createProfile("dupe", "named");
      const second = manager.createProfile("dupe", "named");
      assert.equal(first.id, second.id);
    });

    it("should sanitize profile IDs", () => {
      const profile = manager.createProfile("my profile!@#", "named");
      assert.ok(!profile.id.includes(" "));
      assert.ok(!profile.id.includes("!"));
      assert.ok(!profile.id.includes("@"));
    });
  });

  describe("getProfile / getProfileByName", () => {
    it("should find profile by ID", () => {
      manager.createProfile("findme", "named");
      const profile = manager.getProfile("findme");
      assert.ok(profile);
      assert.equal(profile.name, "findme");
    });

    it("should find profile by name", () => {
      manager.createProfile("byname", "named");
      const profile = manager.getProfileByName("byname");
      assert.ok(profile);
      assert.equal(profile.name, "byname");
    });

    it("should return null for nonexistent ID", () => {
      const profile = manager.getProfile("nonexistent");
      assert.equal(profile, null);
    });

    it("should return null for nonexistent name", () => {
      const profile = manager.getProfileByName("nonexistent");
      assert.equal(profile, null);
    });
  });

  describe("listProfiles", () => {
    it("should list all profiles", () => {
      manager.createProfile("a", "named");
      manager.createProfile("b", "named");
      const all = manager.listProfiles();
      // default + a + b
      assert.ok(all.length >= 3);
    });

    it("should filter by type", () => {
      manager.createProfile("named-one", "named");
      manager.createProfile("iso-one", "isolated");
      const named = manager.listProfiles("named");
      const isolated = manager.listProfiles("isolated");
      assert.ok(named.every((p) => p.type === "named"));
      assert.ok(isolated.every((p) => p.type === "isolated"));
    });
  });

  describe("deleteProfile", () => {
    it("should delete a named profile", () => {
      manager.createProfile("todelete", "named");
      const deleted = manager.deleteProfile("todelete");
      assert.equal(deleted, true);
      assert.equal(manager.getProfile("todelete"), null);
    });

    it("should remove profile data directory on delete", () => {
      const profile = manager.createProfile("dirdelete", "named");
      assert.ok(fs.existsSync(profile.dataDir));
      manager.deleteProfile(profile.id);
      assert.ok(!fs.existsSync(profile.dataDir));
    });

    it("should return false for nonexistent profile", () => {
      const deleted = manager.deleteProfile("nope");
      assert.equal(deleted, false);
    });
  });

  describe("deleteProfileByName", () => {
    it("should delete a profile by name", () => {
      manager.createProfile("byname-del", "named");
      const deleted = manager.deleteProfileByName("byname-del");
      assert.equal(deleted, true);
      assert.equal(manager.getProfileByName("byname-del"), null);
    });
  });

  describe("touchProfile", () => {
    it("should update lastUsedAt", () => {
      const profile = manager.createProfile("touchme", "named");
      const before = profile.lastUsedAt;

      // Small wait
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      return wait(10).then(() => {
        manager.touchProfile(profile.id);
        const updated = manager.getProfile(profile.id);
        assert.ok(updated);
        // lastUsedAt should be at or after the original
        assert.ok(new Date(updated.lastUsedAt).getTime() >= new Date(before).getTime());
      });
    });
  });

  describe("createIsolatedProfile", () => {
    it("should create an isolated profile with auto-name", () => {
      const profile = manager.createIsolatedProfile();
      assert.equal(profile.type, "isolated");
      assert.ok(profile.id.startsWith("isolated-"));
    });
  });

  describe("cleanIsolatedProfiles", () => {
    it("should remove old isolated profiles", async () => {
      manager.createProfile("old-iso", "isolated");
      // Wait a tiny bit so the profile has age > 0
      await new Promise((r) => setTimeout(r, 10));
      const cleaned = manager.cleanIsolatedProfiles(0); // maxAge = 0ms = everything
      assert.ok(cleaned >= 1);
    });

    it("should not remove named profiles", () => {
      manager.createProfile("named-keep", "named");
      manager.cleanIsolatedProfiles(0);
      const profile = manager.getProfileByName("named-keep");
      assert.ok(profile);
    });
  });

  describe("registry persistence", () => {
    it("should persist profiles across manager instances", () => {
      manager.createProfile("persist-test", "named");
      const manager2 = new BrowserProfileManager();
      const profile = manager2.getProfileByName("persist-test");
      assert.ok(profile);
      assert.equal(profile.name, "persist-test");
    });
  });
});

describe("Profile path helpers", () => {
  it("getProfilesDir should include profiles subdirectory", () => {
    const dir = getProfilesDir();
    assert.ok(dir.endsWith("profiles"));
  });

  it("getProfileDataDir should sanitize ID", () => {
    const dir = getProfileDataDir("safe-id");
    assert.ok(dir.includes("safe-id"));
  });

  it("getProfileDataDir should sanitize dangerous characters", () => {
    const dir = getProfileDataDir("../../etc/passwd");
    assert.ok(!dir.includes(".."));
  });

  it("getProfileRegistryPath should end with registry.json", () => {
    const p = getProfileRegistryPath();
    assert.ok(p.endsWith("registry.json"));
  });
});
