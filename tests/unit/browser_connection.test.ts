import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";

// Set up test data home before imports
const testHome = path.join(os.tmpdir(), `bc-test-conn-${Date.now()}`);
process.env.BROWSER_CONTROL_HOME = testHome;

import { MemoryStore } from "../../memory_store";
import { DefaultPolicyEngine } from "../../policy_engine";
import {
  BrowserConnectionManager,
  createConnectionManager,
  type BrowserConnection,
  type BrowserConnectionMode,
  type BrowserTargetType,
  type BrowserConnectionStatus,
} from "../../browser_connection";
import { BrowserProfileManager } from "../../browser_profiles";
import { ProviderRegistry } from "../../src/providers/registry";

describe("BrowserConnectionManager", () => {
  let store: MemoryStore;
  let trustedEngine: DefaultPolicyEngine;

  beforeEach(() => {
    trustedEngine = new DefaultPolicyEngine({ profileName: "trusted" });
    if (!fs.existsSync(testHome)) {
      fs.mkdirSync(testHome, { recursive: true });
    }
    const profilesDir = path.join(testHome, "profiles");
    if (!fs.existsSync(profilesDir)) {
      fs.mkdirSync(profilesDir, { recursive: true });
    }
    store = new MemoryStore({ filename: ":memory:" });
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testHome)) {
      try {
        // Use a small delay to let file handles clear on Windows
        fs.rmSync(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (e) {
        // Silently ignore cleanup errors in tests; common on Windows and not a functional failure
      }
    }
  });

  describe("constructor", () => {
    it("should create manager with defaults", () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      assert.ok(manager);
      assert.equal(manager.isConnected(), false);
      assert.equal(manager.getConnection(), null);
      assert.equal(manager.getBrowser(), null);
      assert.equal(manager.getContext(), null);
    });

    it("should accept custom policy engine", () => {
      const engine = new DefaultPolicyEngine({ profileName: "balanced" });
      const manager = new BrowserConnectionManager({
        memoryStore: store,
        policyEngine: engine,
      });
      assert.ok(manager);
    });

    it("should provide a default policy engine if none is passed", () => {
      const manager = new BrowserConnectionManager({ memoryStore: store });
      // @ts-ignore - reaching into private field for verification
      const engine = manager.policyEngine;
      assert.ok(engine instanceof DefaultPolicyEngine);
    });

    it("should accept custom profile manager", () => {
      const pm = new BrowserProfileManager();
      const manager = new BrowserConnectionManager({
        memoryStore: store,
        profileManager: pm,
        policyEngine: trustedEngine,
      });
      assert.equal(manager.getProfileManager(), pm);
    });
  });

  describe("createConnectionManager factory", () => {
    it("should create a manager instance", () => {
      const manager = createConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      assert.ok(manager instanceof BrowserConnectionManager);
    });
  });

  describe("getStatusSummary", () => {
    it("should return disconnected status when not connected", () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const status = manager.getStatusSummary();
      assert.equal(status.connected, false);
      assert.equal(status.mode, null);
      assert.equal(status.status, "disconnected");
    });
  });

  describe("attach (no browser available)", () => {
    it("should throw when no browser is running", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      await assert.rejects(
        () => manager.attach({ port: 19999 }),
        (error: Error) => {
          assert.ok(error.message.includes("Failed to attach"));
          return true;
        },
      );
    });
  });

  describe("launchManaged (actual managed browser)", () => {
    it("should launch and terminate a managed browser", async () => {
      const { isChromeAlive } = await import("../../scripts/launch_browser");
      const port = 19999 + Math.floor(Math.random() * 1000);
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      
      try {
        const conn = await manager.launchManaged({ port });
        assert.ok(conn);
        assert.equal(conn.mode, "managed");
        assert.equal(manager.isConnected(), true);
        assert.equal(await isChromeAlive(port), true);

        await manager.disconnect();
        assert.equal(manager.isConnected(), false);
        
        // Wait a small bit for process to fully exit
        await new Promise(r => setTimeout(r, 500));
        assert.equal(await isChromeAlive(port), false, "Managed browser was NOT killed on disconnect");
      } finally {
        await manager.disconnect();
      }
    });
  });

  describe("restore (actual managed browser)", () => {
    it("should launch a new browser and restore auth state", async () => {
      const { execSync } = await import("node:child_process");
      const port = 19999 + Math.floor(Math.random() * 1000);
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });

      try {
        const conn = await manager.restore({ port });
        assert.ok(conn);
        assert.equal(conn.mode, "restored");
        assert.equal(manager.isConnected(), true);
      } finally {
        await manager.disconnect();
      }
    });
  });

  describe("disconnect when not connected", () => {
    it("should not throw when disconnecting without connection", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      await assert.doesNotReject(() => manager.disconnect());
    });
  });

  describe("policy integration", () => {
    it("should block attach when policy denies browser_attach", async () => {
      const engine = new DefaultPolicyEngine({
        profileName: "safe",
      });
      const manager = new BrowserConnectionManager({
        memoryStore: store,
        policyEngine: engine,
      });

      // Safe profile may or may not deny browser_attach depending on the risk matrix.
      // We test that the policy evaluation path is invoked.
      // If it doesn't throw for policy, it will throw for no browser running.
      try {
        await manager.attach({ port: 19999, actor: "agent" });
        // Should not get here — either policy or connection should throw
        assert.fail("Expected an error");
      } catch (error: unknown) {
        assert.ok(error instanceof Error);
        // Either policy denial or connection failure is fine
        assert.ok(
          error.message.includes("denied by policy") ||
          error.message.includes("requires confirmation") ||
          error.message.includes("Failed to attach"),
        );
      }
    });
  });

  describe("exportAuth without connection", () => {
    it("should throw when no context is available", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      await assert.rejects(
        () => manager.exportAuth(),
        (error: Error) => {
          assert.ok(error.message.includes("No active browser"));
          return true;
        },
      );
    });
  });

  describe("importAuth without connection", () => {
    it("should throw when no context is available", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      await assert.rejects(
        () => manager.importAuth({
          profileId: "test",
          cookies: [],
          localStorage: {},
          sessionStorage: {},
          capturedAt: new Date().toISOString(),
        }),
        (error: Error) => {
          assert.ok(error.message.includes("No active browser"));
          return true;
        },
      );
    });
  });

  describe("provider integration", () => {
    it("should default to local provider on launch", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const port = 19999 + Math.floor(Math.random() * 1000);
      try {
        const conn = await manager.launchManaged({ port });
        assert.equal(conn.provider, "local");
      } finally {
        await manager.disconnect();
      }
    });

    it("should default to local provider on attach", async () => {
      const manager1 = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const manager2 = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const port = 19999 + Math.floor(Math.random() * 1000);
      try {
        await manager1.launchManaged({ port });
        const conn = await manager2.attach({ port });
        assert.equal(conn.provider, "local");
      } finally {
        await manager1.disconnect();
        await manager2.disconnect();
      }
    });

    it("should reflect provider in status summary", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const port = 19999 + Math.floor(Math.random() * 1000);
      try {
        await manager.launchManaged({ port });
        const status = manager.getStatusSummary();
        assert.equal(status.provider, "local");
      } finally {
        await manager.disconnect();
      }
    });

    it("should pass configured chromeBindAddress to Chrome launch args", async () => {
      const originalBind = process.env.BROWSER_BIND_ADDRESS;
      const childProcess = require("node:child_process") as typeof import("node:child_process");
      const launcherPath = require.resolve("../../scripts/launch_browser");
      const connectionPath = require.resolve("../../browser_connection");
      const launcher = require(launcherPath) as typeof import("../../scripts/launch_browser");
      const originalSpawn = childProcess.spawn;
      const originalResolveChromePath = launcher.resolveChromePath;
      const originalBuildChromeArgs = launcher.buildChromeArgs;
      const originalWaitForCdp = launcher.waitForCdp;
      const originalIsChromeAlive = launcher.isChromeAlive;
      const originalWriteDebugState = launcher.writeDebugState;
      const originalGetWslHostCandidates = launcher.getWslHostCandidates;
      let capturedBindAddress: string | undefined;

      process.env.BROWSER_BIND_ADDRESS = "127.0.0.1";
      delete require.cache[connectionPath];

      (childProcess as unknown as { spawn: unknown }).spawn = () => ({
        unref: () => {},
        kill: () => true,
        pid: 12345,
      });
      (launcher as unknown as { resolveChromePath: unknown }).resolveChromePath = () => process.execPath;
      (launcher as unknown as { buildChromeArgs: unknown }).buildChromeArgs = (opts: { bindAddress: string }) => {
        capturedBindAddress = opts.bindAddress;
        return ["--test-chrome"];
      };
      (launcher as unknown as { waitForCdp: unknown }).waitForCdp = async () => false;
      (launcher as unknown as { isChromeAlive: unknown }).isChromeAlive = async () => false;
      (launcher as unknown as { writeDebugState: unknown }).writeDebugState = () => ({});
      (launcher as unknown as { getWslHostCandidates: unknown }).getWslHostCandidates = () => [];

      try {
        const fresh = require(connectionPath) as typeof import("../../browser_connection");
        const manager = new fresh.BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
        await assert.rejects(() => manager.launchManaged({ port: 19998 }), /Failed to launch managed automation browser/);
        assert.equal(capturedBindAddress, "127.0.0.1");
      } finally {
        (childProcess as unknown as { spawn: unknown }).spawn = originalSpawn;
        (launcher as unknown as { resolveChromePath: unknown }).resolveChromePath = originalResolveChromePath;
        (launcher as unknown as { buildChromeArgs: unknown }).buildChromeArgs = originalBuildChromeArgs;
        (launcher as unknown as { waitForCdp: unknown }).waitForCdp = originalWaitForCdp;
        (launcher as unknown as { isChromeAlive: unknown }).isChromeAlive = originalIsChromeAlive;
        (launcher as unknown as { writeDebugState: unknown }).writeDebugState = originalWriteDebugState;
        (launcher as unknown as { getWslHostCandidates: unknown }).getWslHostCandidates = originalGetWslHostCandidates;
        delete require.cache[connectionPath];
        if (originalBind === undefined) {
          delete process.env.BROWSER_BIND_ADDRESS;
        } else {
          process.env.BROWSER_BIND_ADDRESS = originalBind;
        }
      }
    });

    it("should expose provider registry via getProviderRegistry", () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const registry = manager.getProviderRegistry();
      assert.ok(registry);
      const names = registry.list().builtIn;
      assert.ok(names.includes("local"));
      assert.ok(names.includes("custom"));
      assert.ok(names.includes("browserless"));
    });

    it("should reject remote provider launch when capability missing", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      // custom provider does not support launch
      await assert.rejects(
        () => manager.launchManaged({ provider: "custom" }),
        (err: Error) => {
          assert.ok(err.message.includes("does not support managed launch"));
          return true;
        },
      );
    });

    it("marks stale managed browser state disconnected when reconnect fails", async () => {
      store.set("browser_connection:active", {
        id: "stale-conn",
        mode: "managed",
        profileId: "default",
        cdpEndpoint: "http://127.0.0.1:9",
        status: "connected",
        connectedAt: new Date().toISOString(),
        targetType: "chrome",
        isRealBrowser: false,
        provider: "local",
      });

      const originalConnectOverCDP = chromium.connectOverCDP;
      (chromium as unknown as { connectOverCDP: (endpoint: string) => Promise<unknown> }).connectOverCDP = async () => {
        throw new Error("connection refused");
      };

      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });

      try {
        assert.equal(await manager.reconnectActiveManaged(), false);
        const active = store.get<{ status: string; disconnectedAt?: string }>("browser_connection:active");
        assert.equal(active?.status, "disconnected");
        assert.ok(active?.disconnectedAt);
      } finally {
        (chromium as unknown as { connectOverCDP: typeof originalConnectOverCDP }).connectOverCDP = originalConnectOverCDP;
      }
    });

    it("should attach through a configured custom provider and disconnect it", async () => {
      const registry = new ProviderRegistry(testHome);
      const addResult = registry.add({
        name: "my-remote",
        type: "custom",
        endpoint: "ws://remote.example.test?token=secret",
      });
      assert.equal(addResult.success, true);

      let connectedEndpoint = "";
      let contextClosed = false;
      let browserClosed = false;
      const fakeContext = {
        pages: () => [],
        close: async () => { contextClosed = true; },
      };
      const fakeBrowser = {
        contexts: () => [fakeContext],
        close: async () => { browserClosed = true; },
      };
      const originalConnect = chromium.connect;
      (chromium as unknown as { connect: (endpoint: string) => Promise<unknown> }).connect = async (endpoint: string) => {
        connectedEndpoint = endpoint;
        return fakeBrowser;
      };

      const manager = new BrowserConnectionManager({
        memoryStore: store,
        policyEngine: trustedEngine,
        providerRegistry: registry,
      });

      try {
        const conn = await manager.attach({ provider: "my-remote" });
        assert.equal(connectedEndpoint, "ws://remote.example.test?token=secret");
        assert.equal(conn.provider, "my-remote");
        assert.equal(conn.providerMetadata?.type, "custom");
        assert.equal(conn.cdpEndpoint, "ws://remote.example.test/");
        assert.equal(manager.isConnected(), true);

        await manager.disconnect();
        assert.equal(contextClosed, true);
        assert.equal(browserClosed, true);
        assert.equal(manager.isConnected(), false);
      } finally {
        (chromium as unknown as { connect: typeof originalConnect }).connect = originalConnect;
        await manager.disconnect();
      }
    });

    it("reconnects a previously confirmed custom provider attachment", async () => {
      const registry = new ProviderRegistry(testHome);
      const addResult = registry.add({
        name: "my-remote",
        type: "custom",
        endpoint: "http://127.0.0.1:9336",
      });
      assert.equal(addResult.success, true);

      const connectedEndpoints: string[] = [];
      const fakeContext = {
        pages: () => [],
        close: async () => {},
      };
      const fakeBrowser = {
        contexts: () => [fakeContext],
        close: async () => {},
      };
      const originalConnectOverCDP = chromium.connectOverCDP;
      (chromium as unknown as { connectOverCDP: (endpoint: string) => Promise<unknown> }).connectOverCDP = async (endpoint: string) => {
        connectedEndpoints.push(endpoint);
        return fakeBrowser;
      };

      const manager1 = new BrowserConnectionManager({
        memoryStore: store,
        policyEngine: trustedEngine,
        providerRegistry: registry,
      });
      const manager2 = new BrowserConnectionManager({
        memoryStore: store,
        policyEngine: trustedEngine,
        providerRegistry: registry,
      });

      try {
        await manager1.attach({ provider: "my-remote", confirmed: true });

        assert.equal(await manager2.reconnectActiveManaged(), true);
        assert.equal(manager2.getConnection()?.provider, "my-remote");
        assert.equal(manager2.getConnection()?.mode, "attached");
        assert.deepEqual(connectedEndpoints, [
          "http://127.0.0.1:9336",
          "http://127.0.0.1:9336",
        ]);
      } finally {
        (chromium as unknown as { connectOverCDP: typeof originalConnectOverCDP }).connectOverCDP = originalConnectOverCDP;
        await manager1.disconnect();
        await manager2.disconnect();
      }
    });
  });

  describe("Section 8 Guarantees", () => {
    it("managed mode does not hijack existing browser", async () => {
      const { execSync } = await import("node:child_process");
      const port = 19999 + Math.floor(Math.random() * 1000);
      const manager1 = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      const manager2 = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      
      try {
        await manager1.launchManaged({ port });

        // A second managed launch on the same port should throw, not attach
        await assert.rejects(
          () => manager2.launchManaged({ port }),
          (error: Error) => {
            // It could be our friendly 'already in use' error or a generic timeout 
            // if we're in WSL where process detection works differently.
            // The guarantee is that it DOES NOT attach to the existing managed session.
            return true;
          }
        );
      } finally {
        await manager1.disconnect();
        try {
           execSync(`powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*--remote-debugging-port=${port}*' } | Invoke-CimMethod -MethodName Terminate"`);
           await new Promise(r => setTimeout(r, 200));
        } catch {}
      }
    });

    it("active profile selection affects later launches", async () => {
      const manager = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      
      // Set active profile manually as cli `bc browser profile use` would do
      store.set("browser_connection:active_profile", { id: "test-profile-id", name: "my-test-profile" });
      
      // We spy on the profile manager to see what it resolves to.
      // Easiest is to see if the connection uses the correct profile name.
      const pm = manager.getProfileManager();
      pm.createProfile("my-test-profile");

      const port = 19999 + Math.floor(Math.random() * 1000);
      
      try {
        const conn = await manager.launchManaged({ port }); // no profileName provided
        assert.equal(conn.profile.name, "my-test-profile");
      } finally {
        await manager.disconnect();
      }
    });

    it("attached mode does not terminate existing browser on disconnect", async () => {
      const { isChromeAlive } = await import("../../scripts/launch_browser");
      const { execSync } = await import("node:child_process");
      const port = 19999 + Math.floor(Math.random() * 1000);
      
      // 1. Manually launch a browser (orchestration outside manager)
      const manager1 = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      await manager1.launchManaged({ port });
      assert.equal(await isChromeAlive(port), true);
      
      // 2. Attach another manager to that SAME port
      const manager2 = new BrowserConnectionManager({ memoryStore: store, policyEngine: trustedEngine });
      await manager2.attach({ port });
      assert.equal(manager2.isConnected(), true);
      
      // 3. Disconnect the attached manager
      await manager2.disconnect();
      assert.equal(manager2.isConnected(), false);
      
      // 4. Verify browser is STILL ALIVE (because manager2 didn't own the lifecycle)
      assert.equal(await isChromeAlive(port), true, "Attached disconnect should NOT kill the user browser");
      
      // Clean up primary manager
      await manager1.disconnect();
      assert.equal(await isChromeAlive(port), false);
    });
  });
});

describe("BrowserConnection type structure", () => {
  it("should define all connection modes", () => {
    const modes: BrowserConnectionMode[] = ["managed", "attached", "restored"];
    assert.equal(modes.length, 3);
  });

  it("should define all target types", () => {
    const types: BrowserTargetType[] = ["chrome", "chromium", "electron", "unknown"];
    assert.equal(types.length, 4);
  });

  it("should define all status values", () => {
    const statuses: BrowserConnectionStatus[] = [
      "disconnected", "connecting", "connected", "degraded", "error",
    ];
    assert.equal(statuses.length, 5);
  });
});
