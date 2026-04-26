import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserControl } from "../../browser_control";
import { createRunReport, finishRunReport, recordWorkflow, writeReliabilityReport } from "../support/reliability_report";
import { scanForBrowserControlLeftovers, summarizeCleanupFailure } from "../support/process_cleanup";
import { startLocalAppServer, type LocalAppServer } from "../support/test_server";

test("golden local web app workflow uses service resolution and browser a11y actions", async (t) => {
  const startedAt = Date.now();
  const report = createRunReport();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-e2e-local-web-home-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const previousDebugPort = process.env.BROWSER_DEBUG_PORT;
  const debugPort = String(20000 + Math.floor(Math.random() * 1000));
  let server: LocalAppServer | undefined;
  let bc: ReturnType<typeof createBrowserControl> | undefined;
  let status: "pass" | "fail" | "skip" = "fail";
  let errorSummary: string | undefined;

  try {
    process.env.BROWSER_CONTROL_HOME = homeDir;
    process.env.BROWSER_DEBUG_PORT = debugPort;
    server = await startLocalAppServer();
    bc = createBrowserControl({ policyProfile: "trusted" });
    const registered = await bc.service.register({ name: "golden-local-app", port: server.port, path: "/" });
    assert.equal(registered.success, true);

    const opened = await bc.browser.open({ url: "bc://golden-local-app", waitUntil: "domcontentloaded" });
    if (!opened.success && /No browser available|auto-launch failed|Chrome did not become ready|Chrome executable/i.test(opened.error ?? "")) {
      status = "skip";
      errorSummary = opened.error;
      t.skip(`Browser unavailable for local web app workflow: ${opened.error}`);
      return;
    }
    assert.equal(opened.success, true, opened.error);

    const snapshot = await bc.browser.snapshot();
    assert.equal(snapshot.success, true, snapshot.error);
    assert.ok(snapshot.data?.elements.some((element) => element.name === "Golden Local Workflow"));
    const inputRef = snapshot.data?.elements.find((element) => element.role === "textbox" || element.name === "Workflow input")?.ref;
    const buttonRef = snapshot.data?.elements.find((element) => element.role === "button" && element.name === "Save workflow")?.ref;
    assert.ok(inputRef, "Expected snapshot to expose input ref");
    assert.ok(buttonRef, "Expected snapshot to expose button ref");

    const fill = await bc.browser.fill({ target: `@${inputRef}`, text: "section-21", commit: true });
    assert.equal(fill.success, true, fill.error);
    const click = await bc.browser.click({ target: `@${buttonRef}` });
    assert.equal(click.success, true, click.error);

    const after = await bc.browser.snapshot();
    assert.equal(after.success, true, after.error);
    const manager = bc.sessionManager.getBrowserManager();
    const page = manager.getContext()?.pages()[0] ?? manager.getBrowser()?.contexts()[0]?.pages()[0];
    assert.ok(page, "Expected Browser Control to keep an active page after open");
    const statusText = await page.locator("#golden-status").textContent();
    assert.equal(statusText, "Saved: section-21");
    status = "pass";
  } catch (error) {
    errorSummary = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await bc?.browser.close().catch(() => undefined);
    await bc?.sessionManager.getBrowserManager().disconnect().catch(() => undefined);
    bc?.close();
    await server?.close();
    const cleanup = await scanForBrowserControlLeftovers({
      commandFragments: [homeDir, "e2e/fixtures/local-app/server.cjs"],
      fixturePids: [server?.pid],
    });
    const cleanupFailure = summarizeCleanupFailure(cleanup);
    const shouldThrowCleanup = Boolean(cleanupFailure && status !== "fail");
    if (cleanupFailure) {
      status = "fail";
      errorSummary = cleanupFailure;
    }
    recordWorkflow(report, {
      name: "local web app",
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
    if (previousDebugPort === undefined) {
      delete process.env.BROWSER_DEBUG_PORT;
    } else {
      process.env.BROWSER_DEBUG_PORT = previousDebugPort;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
