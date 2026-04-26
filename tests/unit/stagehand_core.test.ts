import assert from "node:assert/strict";
import test from "node:test";

import { getCdpWebSocketUrl, StagehandManager } from "../../stagehand_core";

test("getCdpWebSocketUrl uses the resolved debug base url", async () => {
  let requestedUrl = "";

  const webSocketDebuggerUrl = await getCdpWebSocketUrl(9222, {
    resolveDebugUrl: async () => "http://172.20.32.1:9222",
    fetchImpl: async (input) => {
      requestedUrl = String(input);

      return new Response(JSON.stringify({
        webSocketDebuggerUrl: "ws://172.20.32.1:9222/devtools/browser/test",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(requestedUrl, "http://172.20.32.1:9222/json/version");
  assert.equal(webSocketDebuggerUrl, "ws://172.20.32.1:9222/devtools/browser/test");
});

test("StagehandManager listSessions returns empty array initially", () => {
  const manager = new StagehandManager();
  assert.deepEqual(manager.listSessions(), []);
});

test("StagehandManager getSession returns undefined for unknown session", () => {
  const manager = new StagehandManager();
  assert.equal(manager.getSession("nonexistent"), undefined);
});

test("StagehandManager destroySession is a no-op for unknown session", async () => {
  const manager = new StagehandManager();
  // Should not throw
  await manager.destroySession("nonexistent");
  assert.deepEqual(manager.listSessions(), []);
});

test("StagehandManager closeAll on empty manager does not throw", async () => {
  const manager = new StagehandManager();
  await manager.closeAll();
  assert.deepEqual(manager.listSessions(), []);
});

test("StagehandManager session tracking — list, get, destroy", () => {
  // Test the internal session map behavior by accessing sessions via list/get
  const manager = new StagehandManager();

  // Verify empty state
  assert.equal(manager.getSession("test"), undefined);
  assert.deepEqual(manager.listSessions(), []);

  // Cannot test createSession without a live browser, but we verify the data contract:
  // - listSessions() always returns a new array (not a reference to internal state)
  const sessions1 = manager.listSessions();
  const sessions2 = manager.listSessions();
  assert.notStrictEqual(sessions1, sessions2); // different array instances
  assert.deepEqual(sessions1, sessions2); // same content
});
