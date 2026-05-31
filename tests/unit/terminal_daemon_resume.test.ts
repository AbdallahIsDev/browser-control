import assert from "node:assert/strict";
import test from "node:test";

import { Daemon } from "../../src/daemon";
import { MemoryStore } from "../../src/memory_store";
import { TerminalBufferStore } from "../../src/terminal_buffer_store";
import type { SerializedTerminalSession } from "../../src/terminal_resume_types";

test("daemon terminal resume lifecycle persists and restores metadata/buffer without redacted env", async () => {
  const memoryStore = new MemoryStore({ filename: ":memory:" });
  const appConfig = {
    terminalMaxScrollbackLines: 100,
    terminalAutoResume: true,
    terminalResumePolicy: "resume",
  };

  const sourceDaemon = new Daemon({ memoryStore });
  const serializedAt = new Date().toISOString();
  const fakeSession = {
    id: "term-resume-1",
    getSerializeableState: () => ({
      id: "term-resume-1",
      name: "resume-test",
      shell: process.platform === "win32" ? "powershell" : "bash",
      cwd: process.cwd(),
      env: {
        PATH: "/usr/bin",
        API_KEY: "secret-value",
      },
      status: "running",
      createdAt: serializedAt,
      lastActivityAt: serializedAt,
      _outputBuffer: "line before restart\n$ ",
      _runningCommand: "npm test",
      _history: ["npm test"],
      pid: 12345,
    }),
  };

  (sourceDaemon as unknown as { memoryStore: MemoryStore }).memoryStore = memoryStore;
  (sourceDaemon as unknown as { appConfig: typeof appConfig }).appConfig = appConfig;
  (sourceDaemon as unknown as { terminalManager: { list: () => unknown[] } }).terminalManager = {
    list: () => [fakeSession],
  };

  await (sourceDaemon as unknown as { serializeTerminals: () => Promise<void> }).serializeTerminals();

  const store = new TerminalBufferStore(memoryStore);
  assert.deepEqual(store.listPending(), ["term-resume-1"]);

  let createConfig: Record<string, unknown> | undefined;
  let injectedOutput = "";
  const restoredSession = {
    id: "term-resume-1",
    shell: process.platform === "win32" ? "powershell" : "bash",
    cwd: process.cwd(),
    status: "idle",
    resumeMetadata: undefined as unknown,
    injectOutput: (output: string) => {
      injectedOutput = output;
    },
  };

  const restoreDaemon = new Daemon({ memoryStore });
  (restoreDaemon as unknown as { memoryStore: MemoryStore }).memoryStore = memoryStore;
  (restoreDaemon as unknown as { appConfig: typeof appConfig }).appConfig = appConfig;
  (restoreDaemon as unknown as { terminalManager: { create: (config: Record<string, unknown>) => Promise<typeof restoredSession> } }).terminalManager = {
    create: async (config) => {
      createConfig = config;
      return restoredSession;
    },
  };

  await (restoreDaemon as unknown as { restoreTerminals: () => Promise<void> }).restoreTerminals();

  assert.equal(createConfig?.id, "term-resume-1");
  assert.deepEqual(createConfig?.env, { PATH: "/usr/bin" });
  assert.equal(injectedOutput, "line before restart\n$ ");
  assert.deepEqual(store.listPending(), ["term-resume-1"], "pending marker remains until the next clean serialization");
  assert.deepEqual(restoredSession.resumeMetadata, {
    restored: true,
    resumeLevel: 2,
    status: "resumed",
    preserved: { metadata: true, buffer: true },
    lost: [
      "live process continuity",
      "running command was not continued: npm test",
      "redacted env var omitted: API_KEY",
    ],
    priorStatus: "running",
    priorRunningCommand: "npm test",
    originalCreatedAt: serializedAt,
    reconstructedAt: (restoredSession.resumeMetadata as { reconstructedAt: string }).reconstructedAt,
  });

  memoryStore.close();
});

test("daemon terminal resume respects DaemonConfig autoRestoreSession override", async () => {
  const memoryStore = new MemoryStore({ filename: ":memory:" });
  const store = new TerminalBufferStore(memoryStore);
  const now = new Date().toISOString();
  const serialized: SerializedTerminalSession = {
    sessionId: "term-resume-disabled",
    name: "disabled-resume-test",
    shell: process.platform === "win32" ? "powershell" : "bash",
    cwd: process.cwd(),
    env: {},
    history: [],
    scrollbackBuffer: ["previous output"],
    runningCommand: undefined,
    status: "idle",
    resumeLevel: 2,
    serializedAt: now,
    createdAt: now,
    lastActivityAt: now,
  };

  store.saveSession(serialized.sessionId, serialized);
  store.saveBuffer(serialized.sessionId, {
    sessionId: serialized.sessionId,
    scrollback: ["previous output"],
    visibleContent: "previous output",
    capturedAt: now,
  });
  store.markPending(serialized.sessionId);

  const daemon = new Daemon({ memoryStore, autoRestoreSession: false });
  (daemon as unknown as { appConfig: { terminalAutoResume: boolean; terminalResumePolicy: "resume" } }).appConfig = {
    terminalAutoResume: true,
    terminalResumePolicy: "resume",
  };
  (daemon as unknown as { terminalManager: { create: () => Promise<never> } }).terminalManager = {
    create: async () => {
      throw new Error("terminal restore should be skipped");
    },
  };

  await (daemon as unknown as { restoreTerminals: () => Promise<void> }).restoreTerminals();

  assert.deepEqual(store.listPending(), [serialized.sessionId]);
  memoryStore.close();
});
