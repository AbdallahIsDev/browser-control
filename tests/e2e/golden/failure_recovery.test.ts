import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserControl } from "../../../browser_control";
import { isValidDebugBundleId, loadDebugBundle } from "../../../src/observability/debug_bundle";
import { createRunReport, finishRunReport, recordWorkflow, writeReliabilityReport } from "../support/reliability_report";
import { scanForBrowserControlLeftovers, summarizeCleanupFailure } from "../support/process_cleanup";

test("golden failure recovery workflow emits debug bundle, guidance, and redacts secrets", async () => {
  const startedAt = Date.now();
  const report = createRunReport();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-e2e-recovery-home-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  let bc: ReturnType<typeof createBrowserControl> | undefined;
  const secret = "bc_secret_test_token_12345";
  let status: "pass" | "fail" | "skip" = "fail";
  let errorSummary: string | undefined;
  let debugBundleId: string | undefined;

  try {
    process.env.BROWSER_CONTROL_HOME = homeDir;
    bc = createBrowserControl({ policyProfile: "trusted" });
    const missingPath = path.join(homeDir, secret, "missing.txt");
    const result = await bc.fs.read({ path: missingPath });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /Read failed|File not found/);
    assert.ok(result.recoveryGuidance);
    assert.equal(typeof result.recoveryGuidance?.requiresHuman, "boolean");
    assert.ok(result.recoveryGuidance?.suggestedAction || result.recoveryGuidance?.humanReason || result.recoveryGuidance?.retryReason);
    assert.ok(result.debugBundleId || result.debugBundlePath);
    assert.equal(result.partialDebug, undefined);

    debugBundleId = result.debugBundleId;
    assert.ok(debugBundleId);
    assert.equal(isValidDebugBundleId(debugBundleId), true);
    assert.equal(isValidDebugBundleId("../evil"), false);

    const bundle = loadDebugBundle(debugBundleId, bc.sessionManager.getMemoryStore());
    assert.ok(bundle);
    const serialized = JSON.stringify(bundle);
    assert.ok(!serialized.includes(secret), "debug bundle leaked fake secret");
    assert.ok(serialized.includes("[REDACTED]"));
    assert.ok(bundle.recoveryGuidance.suggestedAction || bundle.recoveryGuidance.humanReason || bundle.recoveryGuidance.retryReason);
    status = "pass";
  } catch (error) {
    errorSummary = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    bc?.close();
    const cleanup = await scanForBrowserControlLeftovers({ commandFragments: [homeDir] });
    const cleanupFailure = summarizeCleanupFailure(cleanup);
    const shouldThrowCleanup = Boolean(cleanupFailure && status !== "fail");
    if (cleanupFailure) {
      status = "fail";
      errorSummary = cleanupFailure;
    }
    recordWorkflow(report, {
      name: "failure recovery",
      status,
      durationMs: Date.now() - startedAt,
      retryCount: 0,
      cleanup,
      debugBundleId,
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
