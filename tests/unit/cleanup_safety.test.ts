import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupDataHome } from "../../src/data_home";
import {
  ensureDataHomeAtPath,
  getRuntimeTempDir,
  getProfilesDir,
  getTradingDir,
} from "../../src/shared/paths";

test("cleanupDataHome: omitted options means dry-run true", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cleanup-omitted-"));
  try {
    ensureDataHomeAtPath(home);
    const tempDir = getRuntimeTempDir(home);
    const staleFile = path.join(tempDir, "stale.tmp");
    fs.writeFileSync(staleFile, "content");
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, oldTime, oldTime);

    // Call without options
    const result = cleanupDataHome(home);
    assert.equal(result.dryRun, true, "Should default to dry-run");
    assert.equal(fs.existsSync(staleFile), true, "Should NOT delete in dry-run");
    assert.equal(result.deleted.length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("cleanupDataHome: explicit dryRun: false without confirm defaults to dry-run", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cleanup-no-confirm-"));
  try {
    ensureDataHomeAtPath(home);
    const tempDir = getRuntimeTempDir(home);
    const staleFile = path.join(tempDir, "stale.tmp");
    fs.writeFileSync(staleFile, "content");
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, oldTime, oldTime);

    // Call with dryRun: false but NO confirm
    const result = cleanupDataHome(home, { dryRun: false });
    assert.equal(result.dryRun, true, "Should default to dry-run when confirmation missing");
    assert.equal(fs.existsSync(staleFile), true, "Should NOT delete without confirmation");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("cleanupDataHome: explicit dryRun: false with correct confirm deletes files", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cleanup-confirmed-"));
  try {
    ensureDataHomeAtPath(home);
    const tempDir = getRuntimeTempDir(home);
    
    const staleFile = path.join(tempDir, "stale.tmp");
    fs.writeFileSync(staleFile, "stale");
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, oldTime, oldTime);

    const result = cleanupDataHome(home, { dryRun: false, confirm: "DELETE_RUNTIME_TEMP" });
    assert.equal(result.dryRun, false);
    assert.equal(fs.existsSync(staleFile), false, "Stale file should be deleted when confirmed");
    assert.ok(result.deleted.includes(staleFile));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("cleanupDataHome: never auto-delete critical folders", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-cleanup-critical-"));
  try {
    ensureDataHomeAtPath(home);
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Profile
    const profileDir = path.join(home, "browser", "profiles", "Default");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "History"), "data");
    fs.utimesSync(profileDir, oldTime, oldTime);
    fs.utimesSync(path.join(profileDir, "History"), oldTime, oldTime);

    // Trading journal
    const journal = path.join(home, "trading", "journals", "2024-01-01.md");
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.writeFileSync(journal, "notes");
    fs.utimesSync(journal, oldTime, oldTime);

    // Run cleanup with dryRun: false and confirm
    const result = cleanupDataHome(home, { dryRun: false, confirm: "DELETE_RUNTIME_TEMP" });
    
    assert.equal(fs.existsSync(path.join(profileDir, "History")), true, "Should NOT delete browser profiles");
    assert.equal(fs.existsSync(journal), true, "Should NOT delete trading journals");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
