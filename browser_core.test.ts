import assert from "node:assert/strict";
import test from "node:test";

import {
  getDebugEndpointCandidates,
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
`);

  assert.deepEqual(candidates, ["172.25.96.1", "8.8.8.8"]);
});
