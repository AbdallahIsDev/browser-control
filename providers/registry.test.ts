import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { ProviderRegistry } from "./registry";

const testHome = path.join(os.tmpdir(), `bc-test-registry-${Date.now()}`);

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    if (!fs.existsSync(testHome)) {
      fs.mkdirSync(testHome, { recursive: true });
    }
    registry = new ProviderRegistry(testHome);
  });

  afterEach(() => {
    try {
      fs.rmSync(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("built-in providers", () => {
    it("should have local, custom, and browserless built-in", () => {
      const result = registry.list();
      const names = result.builtIn;
      assert.ok(names.includes("local"));
      assert.ok(names.includes("custom"));
      assert.ok(names.includes("browserless"));
    });

    it("local should be default active provider", () => {
      assert.equal(registry.getActiveName(), "local");
    });
  });

  describe("provider selection", () => {
    it("should set and get active provider", () => {
      const result = registry.select("browserless");
      assert.equal(result.success, true);
      assert.equal(result.persisted, true);
      assert.equal(registry.getActiveName(), "browserless");
    });

    it("should persist active provider across instances", () => {
      const result = registry.select("custom");
      assert.equal(result.success, true);
      assert.equal(result.persisted, true);

      const registry2 = new ProviderRegistry(testHome);
      assert.equal(registry2.getActiveName(), "custom");
    });

    it("should reject unknown provider selection", () => {
      const result = registry.select("unknown-provider");
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("not found"));
    });
  });

  describe("custom provider CRUD", () => {
    it("should add and retrieve a custom provider", () => {
      const result = registry.add({ name: "my-remote", type: "custom", endpoint: "ws://localhost:9222" });
      assert.equal(result.success, true);
      assert.equal(result.persisted, true);
      const p = registry.get("my-remote");
      assert.equal(p?.name, "my-remote");
      assert.equal(p?.type, "custom");
      assert.equal(p?.endpoint, "ws://localhost:9222");
    });

    it("should not allow overriding built-in providers", () => {
      const result = registry.add({ name: "local", type: "custom", endpoint: "ws://localhost:9222" });
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("built-in"));
    });

    it("should list custom providers alongside built-ins", () => {
      registry.add({ name: "remote-a", type: "custom", endpoint: "ws://a:9222" });
      registry.add({ name: "remote-b", type: "browserless", endpoint: "https://b.example.com" });
      const names = registry.list().builtIn;
      assert.ok(names.includes("local"));
      const customNames = registry.list().providers.map((p) => p.name);
      assert.ok(customNames.includes("remote-a"));
      assert.ok(customNames.includes("remote-b"));
    });

    it("should not expose apiKey values in list output", () => {
      registry.add({ name: "remote-secret", type: "browserless", endpoint: "https://b.example.com", apiKey: "secret-key" });
      const listed = registry.list().providers.find((p) => p.name === "remote-secret");
      assert.ok(listed);
      assert.equal(listed.apiKey, undefined);
      assert.equal(registry.get("remote-secret")?.apiKey, "secret-key");
    });

    it("should redact sensitive endpoint query params in list output", () => {
      registry.add({ name: "remote-url-secret", type: "browserless", endpoint: "wss://b.example.com?token=secret-token&region=us" });
      const listed = registry.list().providers.find((p) => p.name === "remote-url-secret");

      assert.ok(listed);
      assert.ok(!listed.endpoint?.includes("secret-token"));
      assert.equal(listed.endpoint, "wss://b.example.com/?token=***REDACTED***&region=us");
      assert.equal(registry.get("remote-url-secret")?.endpoint, "wss://b.example.com?token=secret-token&region=us");
    });

    it("should remove a custom provider", () => {
      registry.add({ name: "temp", type: "custom", endpoint: "ws://temp:9222" });
      assert.ok(registry.get("temp"));
      const result = registry.remove("temp");
      assert.equal(result.success, true);
      assert.equal(result.persisted, true);
      assert.equal(registry.get("temp"), undefined);
    });

    it("should not allow removing built-in providers", () => {
      const result = registry.remove("local");
      assert.equal(result.success, false);
      assert.equal(result.persisted, false);
    });

    it("should persist custom providers across instances", () => {
      const addResult = registry.add({ name: "persisted", type: "custom", endpoint: "ws://persisted:9222" });
      assert.equal(addResult.success, true);
      assert.equal(addResult.persisted, true);

      const registry2 = new ProviderRegistry(testHome);
      const p = registry2.get("persisted");
      assert.ok(p);
      assert.equal(p?.endpoint, "ws://persisted:9222");
    });
  });

  describe("browserless persistent config", () => {
    it("should allow adding a configured browserless provider", () => {
      const result = registry.add({ name: "browserless", type: "browserless", endpoint: "https://bl.example.com", apiKey: "abc" });
      assert.equal(result.success, true);
      assert.equal(result.persisted, true);
    });

    it("should retrieve configured browserless over built-in shell", () => {
      registry.add({ name: "browserless", type: "browserless", endpoint: "https://bl.example.com", apiKey: "abc" });
      const p = registry.get("browserless");
      assert.equal(p?.endpoint, "https://bl.example.com");
      assert.equal(p?.apiKey, "abc");
    });

    it("should persist browserless config across instances", () => {
      registry.add({ name: "browserless", type: "browserless", endpoint: "https://bl.example.com", apiKey: "abc" });
      const registry2 = new ProviderRegistry(testHome);
      const p = registry2.get("browserless");
      assert.equal(p?.endpoint, "https://bl.example.com");
      assert.equal(p?.apiKey, "abc");
    });

    it("selecting browserless uses configured provider", () => {
      registry.add({ name: "browserless", type: "browserless", endpoint: "https://bl.example.com", apiKey: "abc" });
      const result = registry.select("browserless");
      assert.equal(result.success, true);
      const active = registry.getActive();
      assert.equal(active.endpoint, "https://bl.example.com");
    });

    it("should allow removing configured browserless to reset to built-in", () => {
      registry.add({ name: "browserless", type: "browserless", endpoint: "https://bl.example.com", apiKey: "abc" });
      assert.equal(registry.get("browserless")?.endpoint, "https://bl.example.com");
      const result = registry.remove("browserless");
      assert.equal(result.success, true);
      assert.equal(result.persisted, true);
      // After removal, should fall back to unconfigured built-in
      const p = registry.get("browserless");
      assert.equal(p?.type, "browserless");
      assert.equal(p?.endpoint, undefined);
    });
  });

  describe("save failure rollback", () => {
    function blockProviderRegistryWrites(home: string): void {
      const providersPath = path.join(home, "providers");
      fs.rmSync(providersPath, { recursive: true, force: true });
      fs.writeFileSync(providersPath, "not a directory");
    }

    it("add() write failure returns success:false and does not leave mutated registry", () => {
      const badHome = path.join(os.tmpdir(), `bc-test-registry-ro-${Date.now()}`);
      fs.mkdirSync(badHome, { recursive: true });
      blockProviderRegistryWrites(badHome);

      const roRegistry = new ProviderRegistry(badHome);
      const result = roRegistry.add({ name: "should-fail", type: "custom", endpoint: "ws://x:9222" });

      assert.equal(result.success, false);
      assert.equal(result.persisted, false);
      assert.ok(result.error?.includes("persist"));
      assert.equal(roRegistry.get("should-fail"), undefined);
      fs.rmSync(badHome, { recursive: true, force: true });
    });

    it("select() write failure returns success:false and active provider remains previous value", () => {
      const badHome = path.join(os.tmpdir(), `bc-test-registry-sel-${Date.now()}`);
      fs.mkdirSync(badHome, { recursive: true });
      blockProviderRegistryWrites(badHome);

      const roRegistry = new ProviderRegistry(badHome);
      const result = roRegistry.select("custom");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("persist"));
      assert.equal(roRegistry.getActiveName(), "local");
      fs.rmSync(badHome, { recursive: true, force: true });
    });

    it("remove() write failure returns success:false and provider remains available", () => {
      const badHome = path.join(os.tmpdir(), `bc-test-registry-rm-${Date.now()}`);
      fs.mkdirSync(badHome, { recursive: true });

      const registryWithProvider = new ProviderRegistry(badHome);
      assert.equal(
        registryWithProvider.add({ name: "removable", type: "custom", endpoint: "ws://x:9222" }).success,
        true,
      );
      blockProviderRegistryWrites(badHome);

      const result = registryWithProvider.remove("removable");

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("persist"));
      assert.equal(registryWithProvider.get("removable")?.endpoint, "ws://x:9222");
      fs.rmSync(badHome, { recursive: true, force: true });
    });
  });

  describe("corrupt registry fallback", () => {
    it("should recover from corrupt registry file", () => {
      const registryPath = path.join(testHome, "providers", "registry.json");
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, "not json");

      const registry2 = new ProviderRegistry(testHome);
      const names = registry2.list().builtIn;
      assert.ok(names.includes("local"));
      assert.equal(registry2.getActiveName(), "local");
    });
  });
});
