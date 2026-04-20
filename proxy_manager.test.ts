import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProxyManager,
  loadProxyConfigs,
  toPlaywrightProxySettings,
  validateProxyPool,
  type ProxyConfig,
} from "./proxy_manager";

test("loadProxyConfigs reads proxies from file and PROXY_LIST", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-config-test-"));
  const proxiesPath = path.join(tempDir, "proxies.json");

  fs.writeFileSync(proxiesPath, JSON.stringify([
    "http://127.0.0.1:8001",
    {
      url: "http://127.0.0.1:8002",
      username: "user-two",
      password: "pass-two",
      status: "cooldown",
    },
  ], null, 2));

  try {
    const proxies = loadProxyConfigs({
      cwd: tempDir,
      env: {
        PROXY_LIST: "http://127.0.0.1:8003, http://127.0.0.1:8004",
      },
    });

    assert.deepEqual(proxies, [
      {
        url: "http://127.0.0.1:8001",
        status: "active",
      },
      {
        url: "http://127.0.0.1:8002",
        username: "user-two",
        password: "pass-two",
        status: "cooldown",
      },
      {
        url: "http://127.0.0.1:8003",
        status: "active",
      },
      {
        url: "http://127.0.0.1:8004",
        status: "active",
      },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ProxyManager rotates active proxies and recovers cooldown entries after the cooldown period", () => {
  let now = 1_000;

  const manager = new ProxyManager([
    { url: "http://proxy-a:8001", status: "active" },
    { url: "http://proxy-b:8002", status: "dead" },
    { url: "http://proxy-c:8003", status: "active" },
  ], {
    cooldownMs: 5_000,
    now: () => now,
  });

  assert.equal(manager.getProxy()?.url, "http://proxy-a:8001");
  assert.equal(manager.getProxy()?.url, "http://proxy-c:8003");

  manager.markFailed("http://proxy-a:8001");

  assert.equal(manager.getProxy()?.url, "http://proxy-c:8003");

  now += 6_000;

  assert.equal(manager.getProxy()?.url, "http://proxy-a:8001");
});

test("ProxyManager marks repeatedly failing proxies as dead", () => {
  let now = 10_000;

  const manager = new ProxyManager([
    { url: "http://proxy-a:8001", status: "active" },
  ], {
    cooldownMs: 100,
    maxFailuresBeforeDead: 2,
    now: () => now,
  });

  manager.markFailed("http://proxy-a:8001");
  now += 200;
  manager.markFailed("http://proxy-a:8001");

  assert.equal(manager.getProxy(), null);
  assert.equal(manager.getSnapshot()[0]?.status, "dead");
});

test("toPlaywrightProxySettings strips credentials from the proxy server url", () => {
  const settings = toPlaywrightProxySettings({
    url: "http://embedded-user:embedded-pass@proxy.example.com:8080",
    status: "active",
  });

  assert.deepEqual(settings, {
    server: "http://proxy.example.com:8080",
    username: "embedded-user",
    password: "embedded-pass",
  });
});

test("validateProxyPool returns success and failure results from the provided tester", async () => {
  const manager = new ProxyManager([
    { url: "http://proxy-a:8001", status: "active" },
    { url: "http://proxy-b:8002", status: "active" },
  ]);

  const results = await validateProxyPool(
    manager.getSnapshot(),
    async (proxy: ProxyConfig) => {
      if (proxy.url.endsWith("8001")) {
        return {
          ok: true,
          details: {
            observedIp: "1.2.3.4",
          },
        };
      }

      return {
        ok: false,
        error: "Connection timed out",
      };
    },
  );

  assert.deepEqual(results, [
    {
      proxyUrl: "http://proxy-a:8001",
      ok: true,
      details: {
        observedIp: "1.2.3.4",
      },
    },
    {
      proxyUrl: "http://proxy-b:8002",
      ok: false,
      error: "Connection timed out",
    },
  ]);
});
