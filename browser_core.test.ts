import assert from "node:assert/strict";
import test from "node:test";

import {
  getDebugEndpointCandidates,
  readRouteGatewayCandidates,
  readNameserverCandidates,
  type DebugInteropState,
} from "./browser_core";

test("getDebugEndpointCandidates prefers explicit env override", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      BROWSER_DEBUG_URL: "http://10.0.0.5:9555",
      BROWSER_DEBUG_HOST: "10.0.0.6",
    },
    platform: "linux",
    metadata: null,
    resolvConf: "",
  });

  assert.deepEqual(candidates, ["http://10.0.0.5:9555"]);
});

test("getDebugEndpointCandidates prefers launcher metadata when running in WSL", () => {
  const metadata: DebugInteropState = {
    port: 9222,
    bindAddress: "0.0.0.0",
    windowsLoopbackUrl: "http://127.0.0.1:9222",
    localhostUrl: "http://localhost:9222",
    wslPreferredUrl: "http://172.24.240.1:9222",
    wslHostCandidates: ["172.24.240.1", "192.168.1.25"],
    updatedAt: "2026-04-10T00:00:00.000Z",
  };

  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata,
    resolvConf: "nameserver 172.24.240.1\n",
  });

  assert.deepEqual(candidates, [
    "http://172.24.240.1:9222",
    "http://192.168.1.25:9222",
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});

test("readNameserverCandidates extracts WSL host candidates from resolv.conf", () => {
  const candidates = readNameserverCandidates(`
search lan
nameserver 172.25.96.1
nameserver 8.8.8.8
nameserver 192.168.1.5
`);

  assert.deepEqual(candidates, ["172.25.96.1", "192.168.1.5"]);
});

test("readRouteGatewayCandidates extracts the WSL default gateway from /proc/net/route", () => {
  const candidates = readRouteGatewayCandidates([
    "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
    "eth0\t00000000\t012014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  ].join("\n"));

  assert.deepEqual(candidates, ["172.20.32.1"]);
});

test("getDebugEndpointCandidates falls back to the WSL default gateway when launcher metadata is missing", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata: null,
    resolvConf: "",
    routeTable: [
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
      "eth0\t00000000\t012014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
    ].join("\n"),
  });

  assert.deepEqual(candidates, [
    "http://172.20.32.1:9222",
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});

test("getDebugEndpointCandidates ignores public DNS resolvers when looking for the Windows host from WSL", () => {
  const candidates = getDebugEndpointCandidates(9222, {
    env: {
      WSL_DISTRO_NAME: "Ubuntu",
    },
    platform: "linux",
    metadata: {
      port: 9222,
      bindAddress: "0.0.0.0",
      windowsLoopbackUrl: "http://127.0.0.1:9222",
      localhostUrl: "http://localhost:9222",
      wslPreferredUrl: "http://8.8.8.8:9222",
      wslHostCandidates: ["1.1.1.1", "172.20.32.1"],
      updatedAt: "2026-04-10T00:00:00.000Z",
    },
    resolvConf: "nameserver 8.8.8.8\nnameserver 172.20.32.1\n",
    routeTable: "",
  });

  assert.deepEqual(candidates, [
    "http://172.20.32.1:9222",
    "http://localhost:9222",
    "http://127.0.0.1:9222",
  ]);
});
