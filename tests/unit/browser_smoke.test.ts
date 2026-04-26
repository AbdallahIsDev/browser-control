import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BrowserConnectionManager } from "../../browser_connection";
import { MemoryStore } from "../../memory_store";
import { DefaultPolicyEngine } from "../../policy_engine";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate a free port"));
        }
      });
    });
  });
}

test("managed browser launches, connects, and disconnects cleanly", async (t) => {
  const chromePath = process.env.BROWSER_CHROME_PATH;
  if (!chromePath || !fs.existsSync(chromePath)) {
    t.skip("Set BROWSER_CHROME_PATH to an installed Chrome/Chromium executable to run browser smoke.");
    return;
  }

  const port = await getFreePort();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-browser-smoke-"));
  process.env.BROWSER_CONTROL_HOME = home;

  const memoryStore = new MemoryStore({ filename: ":memory:" });
  const policyEngine = new DefaultPolicyEngine({ profileName: "trusted" });
  const manager = new BrowserConnectionManager({ memoryStore, policyEngine });

  try {
    const connection = await manager.launchManaged({
      port,
      provider: "local",
      profileName: "browser-smoke",
      profileType: "isolated",
    });
    assert.equal(connection.mode, "managed");
    assert.equal(manager.isConnected(), true);
  } finally {
    await manager.disconnect();
    memoryStore.close();
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch {
      // Best-effort cleanup; failed launches may release Chrome profile files slightly late on Windows.
    }
  }
});
