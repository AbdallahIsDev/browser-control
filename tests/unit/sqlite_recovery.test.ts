import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { safeInitDatabase, quarantineDatabase } from "../../src/shared/sqlite_util";
import { MemoryStore } from "../../src/runtime/memory_store";

function makeTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-recovery-test-"));
  const reportsDir = path.join(home, "reports", "sqlite-recovery");
  fs.mkdirSync(reportsDir, { recursive: true });
  return { home, reportsDir };
}

test("safeInitDatabase: quarantines corrupt DB at init with explicit dataHome", () => {
  const { home, reportsDir } = makeTempHome();
  const dbPath = path.join(home, "test.sqlite");
  
  // Create a corrupt file
  fs.writeFileSync(dbPath, "NOT A SQLITE FILE");
  
  // Should not throw, but instead quarantine and return a fresh DB
  // Pass dataHome explicitly to verify resolution without env var
  const db = safeInitDatabase(dbPath, { component: "test-init", dataHome: home });
  assert.ok(db instanceof DatabaseSync);
  db.close();
  
  // Verify quarantine
  const recoveries = fs.readdirSync(reportsDir);
  assert.equal(recoveries.length, 1);
  const recoveryId = recoveries[0];
  const corruptDir = path.join(reportsDir, recoveryId);
  
  assert.ok(fs.existsSync(path.join(corruptDir, "test.sqlite")));
  assert.ok(fs.existsSync(path.join(corruptDir, "recovery-report.json")));
  
  const report = JSON.parse(fs.readFileSync(path.join(corruptDir, "recovery-report.json"), "utf8"));
  assert.equal(report.component, "test-init");
  assert.equal(report.actionTaken, "quarantined_and_recreated");
  assert.equal(report.dataHome, home);
  
  // Fresh DB should be empty
  const db2 = new DatabaseSync(dbPath);
  const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  assert.equal(tables.length, 0);
  db2.close();
  
  fs.rmSync(home, { recursive: true, force: true });
});

test("quarantineDatabase: handles sidecars with explicit dataHome", () => {
  const { home, reportsDir } = makeTempHome();
  const dbPath = path.join(home, "test-sidecars.sqlite");
  
  fs.writeFileSync(dbPath, "corrupt");
  fs.writeFileSync(`${dbPath}-wal`, "wal-data");
  fs.writeFileSync(`${dbPath}-shm`, "shm-data");
  
  quarantineDatabase(dbPath, "test reason", { component: "test-sidecars", dataHome: home });
  
  const recoveries = fs.readdirSync(reportsDir);
  assert.ok(recoveries.length >= 1);
  const corruptDir = path.join(reportsDir, recoveries[0]);
  
  assert.ok(fs.existsSync(path.join(corruptDir, "test-sidecars.sqlite")));
  assert.ok(fs.existsSync(path.join(corruptDir, "test-sidecars.sqlite-wal")));
  assert.ok(fs.existsSync(path.join(corruptDir, "test-sidecars.sqlite-shm")));
  
  fs.rmSync(home, { recursive: true, force: true });
});

test("MemoryStore: handles runtime corruption with path derivation", () => {
  const { home, reportsDir } = makeTempHome();
  
  // Use a canonical path to test derivation (folder named 'memory')
  const canonicalDbPath = path.join(home, "memory", "memory.sqlite");
  fs.mkdirSync(path.dirname(canonicalDbPath), { recursive: true });

  let store2: MemoryStore | undefined;
  try {
    const store = new MemoryStore({ filename: canonicalDbPath });
    store.set("key1", "value1");
    assert.equal(store.get("key1"), "value1");
    
    // Close and corrupt the file manually
    store.close();
    fs.writeFileSync(canonicalDbPath, "NOT A SQLITE FILE".repeat(100));
    
    // Re-open
    store2 = new MemoryStore({ filename: canonicalDbPath });
    
    const val = store2.get("key1");
    // Should be null because it's a fresh DB
    assert.equal(val, null);
    
    // Verify recovery happened under correct home via derivation
    const recoveries = fs.readdirSync(reportsDir);
    assert.ok(recoveries.length >= 1);
    
    const report = JSON.parse(fs.readFileSync(path.join(reportsDir, recoveries[0], "recovery-report.json"), "utf8"));
    assert.equal(report.dataHome, home);
  } finally {
    store2?.close();
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // Ignore EPERM
    }
  }
});

test("quarantineDatabase: preserves original on move failure", () => {
    const { home } = makeTempHome();
    const dbPath = path.join(home, "locked.sqlite");
    fs.writeFileSync(dbPath, "data");
    
    // Open and keep it open to prevent move on Windows
    const db = new DatabaseSync(dbPath);
    
    try {
        if (process.platform === "win32") {
            assert.throws(() => {
                // Should fail because file is locked
                quarantineDatabase(dbPath, "test", { dataHome: home });
            }, /could not be quarantined/i);
            
            assert.ok(fs.existsSync(dbPath), "Original file should still exist");
        }
    } finally {
        db.close();
        fs.rmSync(home, { recursive: true, force: true });
    }
});
