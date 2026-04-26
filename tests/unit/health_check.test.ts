import assert from "node:assert/strict";
import test from "node:test";

import { MemoryStore } from "../../memory_store";
import { HealthCheck } from "../../health_check";

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
