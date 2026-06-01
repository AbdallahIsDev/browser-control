import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryStore } from "../../src/memory_store";
import { HealthCheck } from "../../src/runtime/health_check";
import { ensureDataHome, getChromeDebugPath } from "../../src/shared/paths";

test("HealthCheck runAll derives healthy, degraded, and unhealthy states", async () => {
  const healthy = new HealthCheck({
    checks: [
      {
        name: "cdp",
        critical: true,
        run: async () => ({ status: "pass", details: "ok" }),
      },
      {
        name: "openrouter",
        critical: false,
        run: async () => ({ status: "warn", details: "missing api key" }),
      },
    ],
  });

  const healthyReport = await healthy.runAll();
  assert.equal(healthyReport.overall, "degraded");

  const unhealthy = new HealthCheck({
    checks: [
      {
        name: "cdp",
        critical: true,
        run: async () => ({ status: "fail", details: "offline" }),
      },
    ],
  });

  const unhealthyReport = await unhealthy.runAll();
  assert.equal(unhealthyReport.overall, "unhealthy");
});

test("HealthCheck runCritical honors conditional criticality rules", async () => {
  const healthCheck = new HealthCheck({
    env: {
      PROXY_LIST: "http://127.0.0.1:8001",
      CAPTCHA_PROVIDER: "2captcha",
      AI_AGENT_MODEL: "openai/gpt-4.1-mini",
    },
    checks: [
      {
        name: "cdp",
        critical: true,
        run: async () => ({ status: "pass" }),
      },
      {
        name: "proxyPool",
        critical: ({ env }) => Boolean(env.PROXY_LIST),
        run: async () => ({ status: "pass" }),
      },
      {
        name: "captchaSolver",
        critical: ({ env }) => Boolean(env.CAPTCHA_PROVIDER),
        run: async () => ({ status: "pass" }),
      },
      {
        name: "openrouter",
        critical: ({ env }) => Boolean(env.AI_AGENT_MODEL),
        run: async () => ({ status: "pass" }),
      },
    ],
  });

  assert.equal(await healthCheck.runCritical(), true);
});

test("HealthCheck checkMemoryStore writes, reads, and cleans up a reserved key", async () => {
  const store = new MemoryStore({ filename: ":memory:" });
  const healthCheck = new HealthCheck({
    memoryStore: store,
  });

  const result = await healthCheck.checkMemoryStore();

  assert.equal(result.status, "pass");
  assert.deepEqual(store.keys("health_check:"), []);
  store.close();
});

test("HealthCheck reuses CDP readiness probe results within one run", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-health-check-"));
  const originalHome = process.env.BROWSER_CONTROL_HOME;
  let probeCount = 0;
  let healthCheck!: HealthCheck;

  try {
    process.env.BROWSER_CONTROL_HOME = home;
    ensureDataHome();
    fs.mkdirSync(path.dirname(getChromeDebugPath()), { recursive: true });
    fs.writeFileSync(getChromeDebugPath(), JSON.stringify({ port: 9222 }));

    healthCheck = new HealthCheck({
      debugPortReady: async (port) => {
        probeCount += 1;
        assert.equal(port, 9222);
        return true;
      },
      checks: [
        { name: "cdpConnection", critical: false, run: async () => healthCheck.checkCdpConnection(9222) },
        { name: "browserState", critical: false, run: async () => healthCheck.checkBrowserState() },
      ],
    });

    const report = await healthCheck.runAll();

    assert.equal(report.overall, "healthy");
    assert.equal(probeCount, 1);
    assert.deepEqual(report.checks.map((check) => check.status), ["pass", "pass"]);
  } finally {
    if (originalHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
