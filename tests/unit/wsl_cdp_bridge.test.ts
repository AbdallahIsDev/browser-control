import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

const { startTcpBridge } = require("../../wsl_cdp_bridge.cjs");

test("startTcpBridge forwards HTTP requests to the upstream debug endpoint", async (t) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress === "object");
  const upstreamPort = (upstreamAddress as AddressInfo).port;

  const bridge = await startTcpBridge({
    listenHost: "127.0.0.1",
    listenPort: 0,
    targetHost: "127.0.0.1",
    targetPort: upstreamPort,
  });

  t.after(() => new Promise<void>((resolve, reject) => bridge.close((error?: Error | null) => {
    if (error) {
      reject(error);
      return;
    }
    resolve();
  })));

  const bridgeAddress = bridge.address();
  assert.ok(bridgeAddress && typeof bridgeAddress === "object");
  const bridgePort = (bridgeAddress as AddressInfo).port;

  const response = await fetch(`http://127.0.0.1:${bridgePort}/json/version`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true });
});
