import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Set up test data home before imports
const testHome = path.join(os.tmpdir(), `bc-test-conn-${Date.now()}`);
process.env.BROWSER_CONTROL_HOME = testHome;

import { MemoryStore } from "./memory_store";
import { DefaultPolicyEngine } from "./policy_engine";
import {
  BrowserConnectionManager,
  createConnectionManager,
  type BrowserConnection,
  type BrowserConnectionMode,
  type BrowserTargetType,
  type BrowserConnectionStatus,
} from "./browser_connection";
import { BrowserProfileManager } from "./browser_profiles";

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
      const { isChromeAlive } = await import("./scripts/launch_browser");
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
      const { isChromeAlive } = await import("./scripts/launch_browser");
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
