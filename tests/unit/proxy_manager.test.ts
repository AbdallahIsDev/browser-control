import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LocalhostProxyManager,
  loadProxyConfigs,
  resolveLocalhostProxyHost,
  toPlaywrightProxySettings,
} from "../../src/proxy_manager";
import { ServiceRegistry } from "../../src/services/registry";

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

function startBackend(label: string): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.setHeader("connection", "keep-alive");
    response.setHeader("proxy-authenticate", "Basic realm=upstream");
    response.setHeader("x-backend-label", label);
    response.end(JSON.stringify({
      label,
      url: request.url,
      host: request.headers.host,
      proxied: request.headers["x-browser-control-localhost-proxy"],
    }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function requestViaProxy(url: string, host: string, timeoutMs?: number): Promise<{
  status: number;
  body: unknown;
  headers: http.IncomingHttpHeaders;
}> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: { host },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode ?? 0,
          body: text ? JSON.parse(text) : null,
          headers: response.headers,
        });
      });
    });
    request.on("error", reject);
    if (timeoutMs !== undefined) {
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Proxy request timed out after ${timeoutMs}ms`));
      });
    }
    request.end();
  });
}

test("resolveLocalhostProxyHost accepts service and worktree subdomains only", () => {
  assert.deepEqual(resolveLocalhostProxyHost("myapp.localhost"), { serviceName: "myapp" });
  assert.deepEqual(resolveLocalhostProxyHost("worktree.myapp.localhost:8080"), { serviceName: "myapp" });
  assert.match(resolveLocalhostProxyHost("localhost").error ?? "", /\.localhost/u);
  assert.match(resolveLocalhostProxyHost("bad_label.localhost").error ?? "", /Invalid/u);
  assert.match(resolveLocalhostProxyHost("..localhost").error ?? "", /Invalid/u);
});

test("LocalhostProxyManager routes .localhost hosts through current service registry entries", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-localhost-proxy-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = tempHome;
  const registry = new ServiceRegistry();
  const first = await startBackend("first");
  const second = await startBackend("second");
  const proxy = new LocalhostProxyManager({ registry, port: 0 });

  try {
    registry.register({ name: "myapp", port: first.port, path: "/base" });
    const started = await proxy.start();
    assert.equal(started.enabled, true);
    assert.equal(started.host, "127.0.0.1");
    assert.ok(started.port > 0);

    const firstResponse = await requestViaProxy(
      `${started.url}/hello?x=1`,
      `myapp.localhost:${started.port}`,
    );
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(firstResponse.body, {
      label: "first",
      url: "/base/hello?x=1",
      host: `127.0.0.1:${first.port}`,
      proxied: "1",
    });
    assert.equal(firstResponse.headers["x-backend-label"], "first");
    assert.equal(firstResponse.headers["proxy-authenticate"], undefined);

    registry.register({ name: "myapp", port: second.port, path: "/" });
    const secondResponse = await requestViaProxy(
      `${started.url}/after-restart`,
      `feature.myapp.localhost:${started.port}`,
    );
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(secondResponse.body, {
      label: "second",
      url: "/after-restart",
      host: `127.0.0.1:${second.port}`,
      proxied: "1",
    });
  } finally {
    await proxy.stop();
    await first.close();
    await second.close();
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("LocalhostProxyManager reloads durable service registry entries between requests", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-localhost-proxy-reload-"));
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = tempHome;
  const first = await startBackend("first");
  const second = await startBackend("second");
  const proxy = new LocalhostProxyManager({ port: 0 });

  try {
    new ServiceRegistry().register({ name: "myapp", port: first.port, path: "/" });
    const started = await proxy.start();
    const firstResponse = await requestViaProxy(
      `${started.url}/stable`,
      `myapp.localhost:${started.port}`,
    );
    assert.equal(firstResponse.status, 200);
    assert.equal((firstResponse.body as { label?: string }).label, "first");

    new ServiceRegistry().register({ name: "myapp", port: second.port, path: "/" });
    const secondResponse = await requestViaProxy(
      `${started.url}/stable`,
      `myapp.localhost:${started.port}`,
    );
    assert.equal(secondResponse.status, 200);
    assert.equal((secondResponse.body as { label?: string }).label, "second");
  } finally {
    await proxy.stop();
    await first.close();
    await second.close();
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("LocalhostProxyManager rejects non-localhost hosts and cleans up listener", async () => {
  const registry = new ServiceRegistry();
  const proxy = new LocalhostProxyManager({ registry, port: 0 });
  const started = await proxy.start();
  const badHost = await requestViaProxy(started.url, "example.com");
  assert.equal(badHost.status, 400);
  await proxy.stop();
  assert.equal(proxy.getStatus().enabled, false);
  await assert.rejects(fetch(started.url), /fetch failed/u);
});

test("LocalhostProxyManager returns a proxy error when registry state is malformed", async () => {
  const registry = {
    get(name: string) {
      if (name !== "myapp") return null;
      return {
        name,
        port: 1,
        protocol: "ftp",
        path: "/",
        registeredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
  } as unknown as ServiceRegistry;
  const proxy = new LocalhostProxyManager({ registry, port: 0 });
  const started = await proxy.start();

  try {
    const response = await requestViaProxy(
      started.url,
      `myapp.localhost:${started.port}`,
      500,
    );
    assert.equal(response.status, 502);
    assert.match((response.body as { error?: string }).error ?? "", /proxy request failed/i);
  } finally {
    await proxy.stop();
  }
});

test("LocalhostProxyManager HTTPS requires explicit local CA certificate and key files", async () => {
  const proxy = new LocalhostProxyManager({ https: true, port: 0 });
  await assert.rejects(
    () => proxy.start(),
    /requires explicit --cert and --key/i,
  );

  const missing = new LocalhostProxyManager({
    https: true,
    port: 0,
    certPath: path.join(os.tmpdir(), "missing-localhost-cert.pem"),
    keyPath: path.join(os.tmpdir(), "missing-localhost-key.pem"),
  });
  await assert.rejects(
    () => missing.start(),
    /certificate file not found/i,
  );
});
