import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteStateStorage } from "../../src/state/sqlite";
import { resetStateStorage, type StoredTask } from "../../src/state/index";

function makeSqliteStorage(): { storage: SqliteStateStorage; home: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-sqlite-"));
  const storage = new SqliteStateStorage(home);
  return { storage, home };
}

test("SqliteStateStorage: saves and retrieves tasks", async () => {
  const { storage, home } = makeSqliteStorage();
  try {
    const task: StoredTask = {
      id: "task-sqlite",
      prompt: "Sqlite test",
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveTask(task);
    const retrieved = await storage.getTask("task-sqlite");
    assert.equal(retrieved?.id, "task-sqlite");
    assert.equal(retrieved?.status, "queued");

    const all = await storage.listTasks();
    assert.ok(all.some(t => t.id === "task-sqlite"));
  } finally {
    storage.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("SqliteStateStorage: durability across restarts", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-sqlite-durable-"));
  const dbPath = path.join(home, "state", "app.sqlite");
  try {
    const storage1 = new SqliteStateStorage(home);
    await storage1.saveTask({
      id: "durable-1",
      prompt: "Persist me",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    storage1.close();

    assert.ok(fs.existsSync(dbPath), "Database file should exist");

    const storage2 = new SqliteStateStorage(home);
    const retrieved = await storage2.getTask("durable-1");
    assert.equal(retrieved?.status, "completed");
    storage2.close();
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("SqliteStateStorage: handles corruption gracefully (re-init)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-sqlite-corrupt-"));
  const dbPath = path.join(home, "state", "app.sqlite");
  const reportsDir = path.join(home, "reports", "sqlite-recovery");
  
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = home;
  
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "NOT A SQLITE FILE");

    // Should NOT throw now, because safeInitDatabase handles it by quarantining
    const storage = new SqliteStateStorage(home);
    assert.ok(storage, "Storage should initialize after recovery");
    storage.close();
    
    // Verify quarantine happened
    assert.ok(fs.existsSync(reportsDir), "Reports directory should exist");
    const recoveries = fs.readdirSync(reportsDir);
    assert.ok(recoveries.length >= 1, "Should have at least one recovery record");
  } finally {
    process.env.BROWSER_CONTROL_HOME = previousHome;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // Ignore EPERM on Windows
    }
  }
});
