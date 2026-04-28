import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

// Set up test data home before imports
const testHome = path.join(os.tmpdir(), `bc-test-services-${Date.now()}`);
process.env.BROWSER_CONTROL_HOME = testHome;

import { ServiceRegistry, type ServiceEntry } from "../../src/services/registry";
import {
  resolveServiceUrl,
  mightBeServiceRef,
  isServiceRef,
  serviceEntryToUrl,
} from "../../src/services/resolver";
import {
  detectDevServer,
  tryDetectDefaultPort,
} from "../../src/services/detector";
import {
  getServicesDir,
  getServiceRegistryPath,
} from "../../src/paths";
import type { BrowserConnectionManager } from "../../src/browser_connection";

function createNoopBrowserManager(): BrowserConnectionManager {
  return {} as BrowserConnectionManager;
}

// ── ServiceRegistry Tests ─────────────────────────────────────────────

describe("ServiceRegistry", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
    registry = new ServiceRegistry();
  });

  afterEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  describe("register", () => {
    it("should register a service with defaults", () => {
      const entry = registry.register({ name: "my-app", port: 3000 });
      assert.equal(entry.name, "my-app");
      assert.equal(entry.port, 3000);
      assert.equal(entry.protocol, "http");
      assert.equal(entry.path, "/");
      assert.ok(entry.registeredAt);
      assert.ok(entry.updatedAt);
    });

    it("should allow https protocol", () => {
      const entry = registry.register({ name: "secure-app", port: 3443, protocol: "https" });
      assert.equal(entry.protocol, "https");
    });

    it("should normalize path", () => {
      const entry = registry.register({ name: "path-app", port: 3000, path: "dashboard" });
      assert.equal(entry.path, "/dashboard");
    });

    it("should reject invalid names", () => {
      assert.throws(() => registry.register({ name: "", port: 3000 }), /Invalid service name/);
      assert.throws(() => registry.register({ name: "a".repeat(65), port: 3000 }), /Invalid service name/);
      assert.throws(() => registry.register({ name: "my app", port: 3000 }), /Invalid service name/);
    });

    it("should reject invalid ports", () => {
      assert.throws(() => registry.register({ name: "bad-port", port: 0 }), /Invalid port/);
      assert.throws(() => registry.register({ name: "bad-port", port: 70000 }), /Invalid port/);
    });

    it("should update an existing service", () => {
      registry.register({ name: "update-me", port: 3000 });
      const updated = registry.register({ name: "update-me", port: 4000, protocol: "https" });
      assert.equal(updated.port, 4000);
      assert.equal(updated.protocol, "https");
    });

    it("should persist to disk", () => {
      registry.register({ name: "persisted", port: 3000 });
      assert.ok(fs.existsSync(getServiceRegistryPath()));
      const raw = fs.readFileSync(getServiceRegistryPath(), "utf8");
      const data = JSON.parse(raw);
      assert.ok(data.services["persisted"]);
    });

    it("should not report success or keep memory mutation when persistence fails", () => {
      const originalWrite = fs.writeFileSync;
      try {
        fs.writeFileSync = (() => {
          throw new Error("simulated write failure");
        }) as typeof fs.writeFileSync;

        assert.throws(
          () => registry.register({ name: "not-persisted", port: 3000 }),
          /Failed to save service registry: simulated write failure/,
        );
        assert.equal(registry.get("not-persisted"), null);
      } finally {
        fs.writeFileSync = originalWrite;
      }
    });
  });

  describe("get", () => {
    it("should return a registered service", () => {
      registry.register({ name: "find-me", port: 3000 });
      const entry = registry.get("find-me");
      assert.ok(entry);
      assert.equal(entry?.name, "find-me");
    });

    it("should return null for unknown service", () => {
      const entry = registry.get("nope");
      assert.equal(entry, null);
    });
  });

  describe("list", () => {
    it("should list all services sorted by name", () => {
      registry.register({ name: "zebra", port: 3000 });
      registry.register({ name: "alpha", port: 3001 });
      const list = registry.list();
      assert.equal(list.length, 2);
      assert.equal(list[0].name, "alpha");
      assert.equal(list[1].name, "zebra");
    });

    it("should return empty array when no services", () => {
      const list = registry.list();
      assert.equal(list.length, 0);
    });
  });

  describe("remove", () => {
    it("should remove a service", () => {
      registry.register({ name: "gone", port: 3000 });
      const removed = registry.remove("gone");
      assert.equal(removed, true);
      assert.equal(registry.get("gone"), null);
    });

    it("should return false for unknown service", () => {
      const removed = registry.remove("nope");
      assert.equal(removed, false);
    });

    it("should not remove from memory when persistence fails", () => {
      registry.register({ name: "keep-me", port: 3000 });

      const originalWrite = fs.writeFileSync;
      try {
        fs.writeFileSync = (() => {
          throw new Error("simulated remove failure");
        }) as typeof fs.writeFileSync;

        assert.throws(
          () => registry.remove("keep-me"),
          /Failed to save service registry: simulated remove failure/,
        );
        assert.ok(registry.get("keep-me"));
      } finally {
        fs.writeFileSync = originalWrite;
      }
    });
  });

  describe("reload", () => {
    it("should reload from disk", () => {
      registry.register({ name: "reload-me", port: 3000 });
      registry.reload();
      const entry = registry.get("reload-me");
      assert.ok(entry);
    });
  });

  describe("corrupt registry recovery", () => {
    it("should recover from corrupt JSON", () => {
      fs.mkdirSync(getServicesDir(), { recursive: true });
      fs.writeFileSync(getServiceRegistryPath(), "not json");
      const freshRegistry = new ServiceRegistry();
      assert.equal(freshRegistry.list().length, 0);
    });

    it("should recover from malformed object", () => {
      fs.mkdirSync(getServicesDir(), { recursive: true });
      fs.writeFileSync(getServiceRegistryPath(), JSON.stringify({ foo: "bar" }));
      const freshRegistry = new ServiceRegistry();
      assert.equal(freshRegistry.list().length, 0);
    });
  });

  // ── Finding 3: Prototype key safety ─────────────────────────────────

  describe("prototype key safety", () => {
    it("should not resolve inherited object properties as services", () => {
      assert.equal(registry.has("constructor"), false);
      assert.equal(registry.get("constructor"), null);
      assert.equal(registry.has("toString"), false);
      assert.equal(registry.get("toString"), null);
      assert.equal(registry.has("__proto__"), false);
      assert.equal(registry.get("__proto__"), null);
    });

    it("should allow explicit registration of prototype-named services", () => {
      registry.register({ name: "constructor", port: 3000 });
      assert.equal(registry.has("constructor"), true);
      const entry = registry.get("constructor");
      assert.ok(entry);
      assert.equal(entry?.port, 3000);
    });
  });
});

// ── ServiceResolver Tests ─────────────────────────────────────────────

describe("ServiceResolver", () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
    registry = new ServiceRegistry();
  });

  afterEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  describe("isServiceRef", () => {
    it("should identify bc:// references", () => {
      assert.equal(isServiceRef("bc://my-app"), true);
      assert.equal(isServiceRef("BC://MY-APP"), true);
    });

    it("should reject non-bc:// inputs", () => {
      assert.equal(isServiceRef("http://example.com"), false);
      assert.equal(isServiceRef("my-app"), false);
    });
  });

  describe("resolveServiceUrl", () => {
    it("should resolve bc://name to registered service", async () => {
      registry.register({ name: "trading-dashboard", port: 5173 });
      const result = await resolveServiceUrl("bc://trading-dashboard", registry, true);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "http://127.0.0.1:5173");
    });

    it("should resolve bare registered name", async () => {
      registry.register({ name: "my-app", port: 3000 });
      const result = await resolveServiceUrl("my-app", registry, true);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "http://127.0.0.1:3000");
    });

    it("should leave real http URLs untouched", async () => {
      const result = await resolveServiceUrl("https://example.com", registry);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "https://example.com");
    });

    it("should leave real localhost URLs untouched", async () => {
      const result = await resolveServiceUrl("http://127.0.0.1:3000", registry);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "http://127.0.0.1:3000");
    });

    it("should not misclassify dotted hostnames as service refs", async () => {
      const result = await resolveServiceUrl("example.com", registry);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "example.com");
    });

    it("should return error for unknown bc:// service", async () => {
      const result = await resolveServiceUrl("bc://unknown", registry);
      assert.ok("error" in result);
      assert.equal((result as { code: string }).code, "unknown_service");
    });

    it("should passthrough unknown bare names", async () => {
      const result = await resolveServiceUrl("unknown-name", registry);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "unknown-name");
    });

    it("should include path in resolved URL", async () => {
      registry.register({ name: "path-app", port: 3000, path: "/admin" });
      const result = await resolveServiceUrl("bc://path-app", registry, true);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "http://127.0.0.1:3000/admin");
    });

    it("should use https when registered with https", async () => {
      registry.register({ name: "secure", port: 3443, protocol: "https" });
      const result = await resolveServiceUrl("bc://secure", registry, true);
      assert.ok("url" in result);
      assert.equal((result as { url: string }).url, "https://127.0.0.1:3443");
    });

    // ── Finding 3: Prototype key safety in resolver ─────────────────
    it("should return unknown_service for bc://constructor when not registered", async () => {
      const result = await resolveServiceUrl("bc://constructor", registry, true);
      assert.ok("error" in result);
      assert.equal((result as { code: string }).code, "unknown_service");
    });

    // ── Finding 4: Endpoint-aware health cache ─────────────────────
    it("should not reuse stale health cache after re-registration to different port", async () => {
      // Start a temporary TCP server on an ephemeral port
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const livePort = (server.address() as net.AddressInfo).port;

      try {
        registry.register({ name: "shifting-app", port: livePort });
        const result1 = await resolveServiceUrl("bc://shifting-app", registry);
        assert.ok("url" in result1);
        assert.equal((result1 as { url: string }).url, `http://127.0.0.1:${livePort}`);

        // Re-register to an unused port
        registry.register({ name: "shifting-app", port: 1 });
        const result2 = await resolveServiceUrl("bc://shifting-app", registry);
        assert.ok("error" in result2);
        assert.equal((result2 as { code: string }).code, "unhealthy_service");
      } finally {
        server.close();
      }
    });
  });

  describe("mightBeServiceRef", () => {
    it("should return true for bc:// refs", () => {
      assert.equal(mightBeServiceRef("bc://app", registry), true);
    });

    it("should return true for registered bare names", () => {
      registry.register({ name: "app", port: 3000 });
      assert.equal(mightBeServiceRef("app", registry), true);
    });

    it("should return false for real URLs", () => {
      assert.equal(mightBeServiceRef("http://example.com", registry), false);
    });

    it("should return false for dotted hostnames", () => {
      assert.equal(mightBeServiceRef("example.com", registry), false);
    });
  });

  describe("serviceEntryToUrl", () => {
    it("should build URL from entry", () => {
      const entry: ServiceEntry = {
        name: "app",
        port: 3000,
        protocol: "http",
        path: "/",
        registeredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      assert.equal(serviceEntryToUrl(entry), "http://127.0.0.1:3000");
    });

    it("should include path when not root", () => {
      const entry: ServiceEntry = {
        name: "app",
        port: 3000,
        protocol: "http",
        path: "/dashboard",
        registeredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      assert.equal(serviceEntryToUrl(entry), "http://127.0.0.1:3000/dashboard");
    });
  });
});

// ── DevServerDetector Tests ───────────────────────────────────────────

describe("DevServerDetector", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-detector-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("tryDetectDefaultPort", () => {
    it("should return Vite default port", () => {
      assert.equal(tryDetectDefaultPort("vite"), 5173);
    });

    it("should return Next.js default port", () => {
      assert.equal(tryDetectDefaultPort("next"), 3000);
      assert.equal(tryDetectDefaultPort("next.js"), 3000);
    });

    it("should return Webpack default port", () => {
      assert.equal(tryDetectDefaultPort("webpack"), 8080);
    });

    it("should return null for unknown frameworks", () => {
      assert.equal(tryDetectDefaultPort("unknown"), null);
    });
  });

  describe("detectDevServer", () => {
    it("should detect Vite from vite.config.ts", () => {
      fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default {}");
      const result = detectDevServer(tempDir);
      assert.ok(result);
      assert.equal(result?.name, "vite");
      assert.equal(result?.port, 5173);
    });

    it("should detect Next.js from next.config.js", () => {
      fs.writeFileSync(path.join(tempDir, "next.config.js"), "module.exports = {}");
      const result = detectDevServer(tempDir);
      assert.ok(result);
      assert.equal(result?.name, "next");
      assert.equal(result?.port, 3000);
    });

    it("should detect Webpack from webpack.config.js", () => {
      fs.writeFileSync(path.join(tempDir, "webpack.config.js"), "module.exports = {}");
      const result = detectDevServer(tempDir);
      assert.ok(result);
      assert.equal(result?.name, "webpack");
      assert.equal(result?.port, 8080);
    });

    it("should detect custom port from vite config content", () => {
      fs.writeFileSync(
        path.join(tempDir, "vite.config.ts"),
        `export default { server: { port: 4000 } }`,
      );
      const result = detectDevServer(tempDir);
      assert.ok(result);
      assert.equal(result?.port, 4000);
      assert.equal(result?.source, "config");
    });

    it("should detect custom port from package.json scripts", () => {
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({ scripts: { dev: "vite --port 9000" } }),
      );
      const result = detectDevServer(tempDir);
      assert.ok(result);
      assert.equal(result?.port, 9000);
      assert.equal(result?.source, "package_json");
    });

    it("should return null when no known server is present", () => {
      const result = detectDevServer(tempDir);
      assert.equal(result, null);
    });
  });
});

// ── ServiceActions detect-without-port Tests ──────────────────────────

describe("ServiceActions detect integration", () => {
  let tempDir: string;

  beforeEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-detector-"));
  });

  afterEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should register without --port when detection succeeds", async () => {
    fs.writeFileSync(path.join(tempDir, "vite.config.ts"), "export default { server: { port: 4321 } }");

    const { ServiceActions } = await import("../../src/service_actions");
    const { SessionManager } = await import("../../src/session_manager");
    const { MemoryStore } = await import("../../src/memory_store");

    const store = new MemoryStore({ filename: ":memory:" });
    try {
      const sessionManager = new SessionManager({
        memoryStore: store,
        browserManager: createNoopBrowserManager(),
      });
      await sessionManager.create("test", { policyProfile: "balanced" });
      const actions = new ServiceActions({ sessionManager });

      const result = await actions.register({
        name: "detected-vite",
        detect: true,
        cwd: tempDir,
      });

      assert.equal(result.success, true);
      assert.equal((result.data as ServiceEntry).port, 4321);
    } finally {
      store.close();
    }
  });

  it("should fail clearly when detection fails and no port is given", async () => {
    const { ServiceActions } = await import("../../src/service_actions");
    const { SessionManager } = await import("../../src/session_manager");
    const { MemoryStore } = await import("../../src/memory_store");

    const store = new MemoryStore({ filename: ":memory:" });
    try {
      const sessionManager = new SessionManager({
        memoryStore: store,
        browserManager: createNoopBrowserManager(),
      });
      await sessionManager.create("test", { policyProfile: "balanced" });
      const actions = new ServiceActions({ sessionManager });

      const result = await actions.register({
        name: "undetected",
        detect: true,
        cwd: tempDir,
      });

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Port is required"));
    } finally {
      store.close();
    }
  });

  it("should still register with explicit port when detection is not used", async () => {
    const { ServiceActions } = await import("../../src/service_actions");
    const { SessionManager } = await import("../../src/session_manager");
    const { MemoryStore } = await import("../../src/memory_store");

    const store = new MemoryStore({ filename: ":memory:" });
    try {
      const sessionManager = new SessionManager({
        memoryStore: store,
        browserManager: createNoopBrowserManager(),
      });
      await sessionManager.create("test", { policyProfile: "balanced" });
      const actions = new ServiceActions({ sessionManager });

      const result = await actions.register({
        name: "explicit-port",
        port: 5555,
      });

      assert.equal(result.success, true);
      assert.equal((result.data as ServiceEntry).port, 5555);
    } finally {
      store.close();
    }
  });
});

// ── Path Helpers Tests ────────────────────────────────────────────────

describe("Service path helpers", () => {
  beforeEach(() => {
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it("getServicesDir should end with services", () => {
    const dir = getServicesDir();
    assert.ok(dir.endsWith("services"));
  });

  it("getServiceRegistryPath should end with registry.json", () => {
    const p = getServiceRegistryPath();
    assert.ok(p.endsWith("registry.json"));
  });
});
