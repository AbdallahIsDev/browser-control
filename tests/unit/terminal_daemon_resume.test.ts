import assert from "node:assert/strict";
import test from "node:test";

import { Daemon } from "../../src/daemon";
import { MemoryStore } from "../../src/memory_store";
import { TerminalBufferStore } from "../../src/terminal_buffer_store";

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
