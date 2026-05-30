import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

const { parseArgs, startTcpBridge } = require("../../wsl_cdp_bridge.cjs");

for (const listenHost of ["0.0.0.0", "::", "localhost"]) {
  test(`parseArgs rejects non-loopback WSL CDP bridge listen host ${listenHost}`, () => {
    assert.throws(
      () =>
        parseArgs([
          "node",
          "wsl_cdp_bridge.cjs",
          "--listen-host",
          listenHost,
          "--listen-port",
          "9223",
          "--target-host",
          "127.0.0.1",
          "--target-port",
          "9222",
        ]),
      /wsl_cdp_bridge must listen on 127\.0\.0\.1 only/,
    );
  });
}

test("parseArgs accepts explicit localhost address for WSL CDP bridge", () => {
  const options = parseArgs([
    "node",
    "wsl_cdp_bridge.cjs",
    "--listen-host",
    "127.0.0.1",
    "--listen-port",
    "9223",
    "--target-host",
    "127.0.0.1",
    "--target-port",
    "9222",
  ]);

  assert.equal(options.listenHost, "127.0.0.1");
  assert.equal(options.listenPort, 9223);
  assert.equal(options.targetHost, "127.0.0.1");
  assert.equal(options.targetPort, 9222);
});

test("startTcpBridge rejects non-localhost listen hosts before opening a socket", () => {
  assert.throws(
    () =>
      startTcpBridge({
        listenHost: "0.0.0.0",
        listenPort: 0,
        targetHost: "127.0.0.1",
        targetPort: 9222,
      }),
    /wsl_cdp_bridge must listen on 127\.0\.0\.1 only/,
  );
});

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
