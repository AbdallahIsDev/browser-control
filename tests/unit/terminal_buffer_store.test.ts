import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { TerminalBufferStore, TERMINAL_PENDING_KEY } from "../../src/terminal_buffer_store";
import { MemoryStore } from "../../src/memory_store";

function createTempStore(): { store: MemoryStore; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-test-"));
  const storePath = path.join(tmpDir, "test.db");
  const store = new MemoryStore({ filename: storePath });
  return {
    store,
    cleanup: () => {
      try {
        store.close();
        fs.unlinkSync(storePath);
        fs.rmdirSync(tmpDir);
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

test("TerminalBufferStore: save and load buffer", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store);

  const record = {
    sessionId: "session-1",
    scrollback: ["line1", "line2"],
    visibleContent: "line2",
    capturedAt: new Date().toISOString(),
  };

  bufferStore.saveBuffer("session-1", record);
  const loaded = bufferStore.loadBuffer("session-1");

  assert.ok(loaded);
  assert.deepEqual(loaded?.scrollback, ["line1", "line2"]);
  assert.equal(loaded?.visibleContent, "line2");
  assert.equal(loaded?.sessionId, "session-1");

  cleanup();
});

test("TerminalBufferStore: returns null for missing buffer", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store);

  const loaded = bufferStore.loadBuffer("nonexistent");
  assert.equal(loaded, null);

  cleanup();
});

test("TerminalBufferStore: save and load session metadata", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store);

  const metadata = {
    sessionId: "s1",
    shell: "bash",
    cwd: "/home/user",
    env: { PATH: "/usr/bin" },
    history: [],
    scrollbackBuffer: [],
    status: "idle" as const,
    resumeLevel: 2 as const,
    serializedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };

  bufferStore.saveSession("s1", metadata);
  const loaded = bufferStore.loadSession("s1");

  assert.ok(loaded);
  assert.equal((loaded as any).sessionId, "s1");
  assert.equal((loaded as any).shell, "bash");

  cleanup();
});

test("TerminalBufferStore: listPending returns marked sessions", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store);

  bufferStore.markPending("session-a");
  bufferStore.markPending("session-b");
  bufferStore.unmarkPending("session-b");

  const pending = bufferStore.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0], "session-a");

  cleanup();
});

test("TerminalBufferStore: delete removes metadata and buffer", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store);

  const record = {
    sessionId: "s1",
    scrollback: ["line1"],
    visibleContent: "line1",
    capturedAt: new Date().toISOString(),
  };

  bufferStore.saveBuffer("s1", record);
  bufferStore.saveSession("s1", { sessionId: "s1" });

  bufferStore.deleteBuffer("s1");
  bufferStore.deleteSession("s1");

  assert.equal(bufferStore.loadBuffer("s1"), null);
  assert.equal(bufferStore.loadSession("s1"), null);

  cleanup();
});

test("TerminalBufferStore: truncates scrollback to max lines", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store, { maxScrollbackLines: 5 });

  const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
  const record = {
    sessionId: "s1",
    scrollback: lines,
    visibleContent: lines.join("\n"),
    capturedAt: new Date().toISOString(),
  };

  bufferStore.saveBuffer("s1", record);
  const loaded = bufferStore.loadBuffer("s1");

  assert.ok(loaded);
  assert.equal(loaded?.scrollback.length, 5);
  // Oldest lines dropped, newest kept
  assert.equal(loaded?.scrollback[0], "line-15");
  assert.equal(loaded?.scrollback[4], "line-19");

  cleanup();
});

test("TerminalBufferStore: enforces max serialized pending sessions", () => {
  const { store, cleanup } = createTempStore();
  const bufferStore = new TerminalBufferStore(store);

  for (const sessionId of ["oldest", "middle", "newest"]) {
    bufferStore.saveSession(sessionId, { sessionId });
    bufferStore.saveBuffer(sessionId, {
      sessionId,
      scrollback: [`buffer-${sessionId}`],
      visibleContent: sessionId,
      capturedAt: new Date().toISOString(),
    });
  }

  store.set(`${TERMINAL_PENDING_KEY}oldest`, { sessionId: "oldest", markedAt: "2026-01-01T00:00:00.000Z" });
  store.set(`${TERMINAL_PENDING_KEY}middle`, { sessionId: "middle", markedAt: "2026-01-02T00:00:00.000Z" });
  store.set(`${TERMINAL_PENDING_KEY}newest`, { sessionId: "newest", markedAt: "2026-01-03T00:00:00.000Z" });

  const removed = bufferStore.enforceMaxSerializedSessions(2);

  assert.deepEqual(removed, ["oldest"]);
  assert.deepEqual(bufferStore.listPending(), ["middle", "newest"]);
  assert.equal(bufferStore.loadSession("oldest"), null);
  assert.equal(bufferStore.loadBuffer("oldest"), null);

  cleanup();
});
