import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrowserControl } from "../../browser_control";
import { ProviderRegistry } from "../../providers/registry";
import { createRunReport, finishRunReport, recordWorkflow, writeReliabilityReport } from "../support/reliability_report";
import { scanForBrowserControlLeftovers, summarizeCleanupFailure } from "../support/process_cleanup";
import { startLocalAppServer, type LocalAppServer } from "../support/test_server";

test("golden provider/service workflow resolves local services and preserves provider selection", async (t) => {
  const startedAt = Date.now();
  const report = createRunReport();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-e2e-provider-home-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const previousDebugPort = process.env.BROWSER_DEBUG_PORT;
  const previousDebugUrl = process.env.BROWSER_DEBUG_URL;
  const previousDebugHost = process.env.BROWSER_DEBUG_HOST;
  const previousBindAddress = process.env.BROWSER_BIND_ADDRESS;
  const previousBrowserMode = process.env.BROWSER_MODE;
  const debugPort = String(21000 + Math.floor(Math.random() * 1000));
  let server: LocalAppServer | undefined;
  let bc: ReturnType<typeof createBrowserControl> | undefined;
  let status: "pass" | "fail" | "skip" = "fail";
  let errorSummary: string | undefined;

  try {
    process.env.BROWSER_CONTROL_HOME = homeDir;
    process.env.BROWSER_DEBUG_PORT = debugPort;
    delete process.env.BROWSER_DEBUG_URL;
    delete process.env.BROWSER_DEBUG_HOST;
    process.env.BROWSER_BIND_ADDRESS = "127.0.0.1";
    process.env.BROWSER_MODE = "managed";
    server = await startLocalAppServer();
    bc = createBrowserControl({ policyProfile: "trusted" });
    const registered = await bc.service.register({ name: "provider-golden-app", port: server.port, path: "/" });
    assert.equal(registered.success, true, registered.error);

    const resolved = await bc.service.resolve({ name: "provider-golden-app" });
    assert.equal(resolved.success, true, resolved.error);
    assert.equal(new URL(resolved.data?.url ?? "").href, server.url);

    const providerRegistry: ProviderRegistry = bc.sessionManager.getBrowserManager().getProviderRegistry();
    const customAdd = providerRegistry.add({
      name: "golden-custom",
      type: "custom",
      endpoint: "http://127.0.0.1:9/json/version?token=bc_secret_test_token_12345",
    });
    assert.equal(customAdd.success, true, customAdd.error);
    const customSelection = providerRegistry.select("golden-custom");
    assert.equal(customSelection.success, true, customSelection.error);
    assert.equal(providerRegistry.getActive().type, "custom");

    const localSelection = providerRegistry.select("local");
    assert.equal(localSelection.success, true);
    assert.equal(bc.provider.getActive(), "local");

    const providerList = bc.provider.list();
    assert.ok(providerList.builtIn.includes("local"));
    assert.equal(providerRegistry.getActive().type, "local");

    const open = await bc.browser.open({ url: "bc://provider-golden-app", waitUntil: "domcontentloaded" });
    if (!open.success && /No browser available|auto-launch failed|Chrome did not become ready|Chrome executable/i.test(open.error ?? "")) {
      assert.equal(bc.provider.getActive(), "local");
      status = "skip";
      errorSummary = open.error;
      t.skip(`Browser unavailable for provider/service workflow: ${open.error}`);
      return;
    }
    assert.equal(open.success, true, open.error);
    assert.equal(open.path, "a11y");
    assert.equal(bc.sessionManager.getBrowserManager().getConnection()?.provider, "local");
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
      name: "provider service",
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
    if (previousDebugUrl === undefined) {
      delete process.env.BROWSER_DEBUG_URL;
    } else {
      process.env.BROWSER_DEBUG_URL = previousDebugUrl;
    }
    if (previousDebugHost === undefined) {
      delete process.env.BROWSER_DEBUG_HOST;
    } else {
      process.env.BROWSER_DEBUG_HOST = previousDebugHost;
    }
    if (previousBindAddress === undefined) {
      delete process.env.BROWSER_BIND_ADDRESS;
    } else {
      process.env.BROWSER_BIND_ADDRESS = previousBindAddress;
    }
    if (previousBrowserMode === undefined) {
      delete process.env.BROWSER_MODE;
    } else {
      process.env.BROWSER_MODE = previousBrowserMode;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
