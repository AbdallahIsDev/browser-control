import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../../../src/memory_store";
import { TerminalBufferStore } from "../../../src/terminal_buffer_store";
import { buildResumeResult, decideResume, loadPersistedState, rebuildOutputBuffer } from "../../../src/terminal_resume";
import type { SerializedTerminalSession } from "../../../src/terminal_resume_types";
import { createRunReport, finishRunReport, recordWorkflow, writeReliabilityReport } from "../support/reliability_report";
import { scanForBrowserControlLeftovers, summarizeCleanupFailure } from "../support/process_cleanup";

test("golden terminal resume workflow preserves metadata and buffer while reporting lost live continuity", async () => {
  const startedAt = Date.now();
  const report = createRunReport();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-e2e-resume-home-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  let store: MemoryStore | undefined;
  let bufferStore: TerminalBufferStore | undefined;
  const sessionId = "golden-terminal-session";
  let status: "pass" | "fail" | "skip" = "fail";
  let errorSummary: string | undefined;

  try {
    process.env.BROWSER_CONTROL_HOME = homeDir;
    store = new MemoryStore();
    bufferStore = new TerminalBufferStore(store);
    const metadata: SerializedTerminalSession = {
      sessionId,
      shell: process.platform === "win32" ? "powershell.exe" : "sh",
      cwd: homeDir,
      status: "running",
      createdAt: "2026-04-25T00:00:00.000Z",
      lastActivityAt: "2026-04-25T00:00:01.000Z",
      serializedAt: "2026-04-25T00:00:01.000Z",
      resumeLevel: 2,
      env: {},
      history: ["node -e \"console.log('golden-resume-output')\""],
      scrollbackBuffer: ["golden-resume-output"],
      runningCommand: "node -e \"console.log('golden-resume-output')\"",
      processInfo: { pid: 12345, commandLine: "node" },
    };
    bufferStore.saveSession(sessionId, metadata);
    bufferStore.saveBuffer(sessionId, {
      sessionId,
      capturedAt: "2026-04-25T00:00:01.000Z",
      scrollback: ["line one", "golden-resume-output"],
      visibleContent: "golden-resume-output",
    });
    bufferStore.markPending(sessionId);

    const persisted = loadPersistedState(bufferStore, sessionId);
    assert.deepEqual(persisted.metadata?.sessionId, sessionId);
    assert.ok(persisted.buffer?.scrollback.includes("golden-resume-output"));

    const decision = decideResume(sessionId, persisted.metadata, persisted.buffer);
    const rebuilt = rebuildOutputBuffer(persisted.buffer);
    const result = buildResumeResult(decision, { id: sessionId, shell: metadata.shell, cwd: homeDir, status: "reconstructed" });

    assert.equal(result.sessionId, sessionId);
    assert.equal(result.status, "resumed");
    assert.equal(result.resumeLevel, 2);
    assert.equal(result.preserved.metadata, true);
    assert.equal(result.preserved.buffer, true);
    assert.ok(result.lost.includes("live process continuity"));
    assert.ok(rebuilt.includes("golden-resume-output"));
    status = "pass";
  } catch (error) {
    errorSummary = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    store?.close();
    const cleanup = await scanForBrowserControlLeftovers({ commandFragments: [homeDir] });
    const cleanupFailure = summarizeCleanupFailure(cleanup);
    const shouldThrowCleanup = Boolean(cleanupFailure && status !== "fail");
    if (cleanupFailure) {
      status = "fail";
      errorSummary = cleanupFailure;
    }
    recordWorkflow(report, {
      name: "terminal resume",
      status,
      durationMs: Date.now() - startedAt,
      retryCount: 0,
      cleanup,
      errorSummary,
    });
    finishRunReport(report);
    writeReliabilityReport(report);
    if (shouldThrowCleanup && cleanupFailure) throw new Error(cleanupFailure);
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
