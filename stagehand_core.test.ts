import assert from "node:assert/strict";
import test from "node:test";

import { getCdpWebSocketUrl } from "./stagehand_core";

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
