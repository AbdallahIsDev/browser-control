import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getProfilesDir, ensureDataHomeAtPath } from "../../src/shared/paths";

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
