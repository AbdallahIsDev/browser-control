import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getProfilesDir, ensureDataHomeAtPath } from "../../src/shared/paths";
import { BrowserProfileManager } from "../../src/browser/profiles";

test("getProfilesDir: respects legacy profiles if they exist", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-profiles-legacy-"));
  try {
    // Manually create legacy profiles dir
    const legacyDir = path.join(home, "profiles");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "test-profile"), "data");

    // This should NOT migrate yet, just return the path
    const profilesDir = getProfilesDir.call({ getDataHome: () => home });
    // Wait, getProfilesDir uses getDataHome() from the same module. 
    // I need to set BROWSER_CONTROL_HOME env var.
    process.env.BROWSER_CONTROL_HOME = home;
    
    const resolvedProfilesDir = getProfilesDir();
    assert.equal(resolvedProfilesDir, legacyDir);
  } finally {
    delete process.env.BROWSER_CONTROL_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("migration: should copy legacy profiles to canonical path", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-profiles-migrate-"));
  try {
    const legacyDir = path.join(home, "profiles");
    fs.mkdirSync(legacyDir, { recursive: true });
    const profileA = path.join(legacyDir, "ProfileA");
    fs.mkdirSync(profileA);
    fs.writeFileSync(path.join(profileA, "Preferences"), "{}");

    // Existing canonical profile should NOT be overwritten
    const canonicalDir = path.join(home, "browser", "profiles");
    fs.mkdirSync(canonicalDir, { recursive: true });
    const profileB = path.join(canonicalDir, "ProfileB");
    fs.mkdirSync(profileB);
    fs.writeFileSync(path.join(profileB, "Preferences"), "canonical");

    // Conflict case
    const conflictLegacy = path.join(legacyDir, "Conflict");
    fs.mkdirSync(conflictLegacy);
    fs.writeFileSync(path.join(conflictLegacy, "data"), "legacy");
    const conflictCanonical = path.join(canonicalDir, "Conflict");
    fs.mkdirSync(conflictCanonical);
    fs.writeFileSync(path.join(conflictCanonical, "data"), "canonical");

    ensureDataHomeAtPath(home);

    assert.equal(fs.existsSync(path.join(canonicalDir, "ProfileA")), true, "ProfileA should be migrated");
    assert.equal(fs.existsSync(path.join(canonicalDir, "ProfileB")), true, "ProfileB should remain");
    assert.equal(fs.readFileSync(path.join(canonicalDir, "Conflict", "data"), "utf8"), "canonical", "Canonical should win in conflict");
    
    // Check report
    const migrationsDir = path.join(home, "reports", "migrations");
    assert.equal(fs.existsSync(migrationsDir), true, "Migrations report dir should exist");
    const reports = fs.readdirSync(migrationsDir);
    assert.ok(reports.length > 0, "At least one report should exist");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("profile purge dry-run reports stale non-default profiles without deleting", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-profiles-purge-dry-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const manager = new BrowserProfileManager();
    const oldProfile = manager.createProfile("old-work", "named");
    const freshProfile = manager.createProfile("fresh-work", "named");
    fs.writeFileSync(path.join(oldProfile.dataDir, "Cache"), "old-cache");

    const registryPath = path.join(getProfilesDir(), "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const old = registry.profiles.find((entry: { id: string }) => entry.id === oldProfile.id);
    const fresh = registry.profiles.find((entry: { id: string }) => entry.id === freshProfile.id);
    old.lastUsedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
    fresh.lastUsedAt = new Date("2026-05-29T00:00:00.000Z").toISOString();
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    manager.reload();

    const result = manager.purgeStaleProfiles({
      olderThanDays: 30,
      dryRun: true,
      now: new Date("2026-05-30T00:00:00.000Z"),
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]?.id, oldProfile.id);
    assert.equal(result.deleted.length, 0);
    assert.equal(fs.existsSync(oldProfile.dataDir), true);
    assert.equal(fs.existsSync(freshProfile.dataDir), true);
    assert.ok(manager.getProfile("default"), "default profile is never a purge candidate");
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("profile purge deletes stale profiles only when confirmed by caller", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-profiles-purge-delete-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const manager = new BrowserProfileManager();
    const oldProfile = manager.createProfile("old-work", "named");
    fs.writeFileSync(path.join(oldProfile.dataDir, "Cache"), "old-cache");

    const registryPath = path.join(getProfilesDir(), "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const old = registry.profiles.find((entry: { id: string }) => entry.id === oldProfile.id);
    old.lastUsedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    manager.reload();

    const result = manager.purgeStaleProfiles({
      olderThanDays: 30,
      dryRun: false,
      now: new Date("2026-05-30T00:00:00.000Z"),
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.deleted.length, 1);
    assert.equal(result.deleted[0]?.id, oldProfile.id);
    assert.equal(fs.existsSync(oldProfile.dataDir), false);
    assert.equal(manager.getProfile(oldProfile.id), null);
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
