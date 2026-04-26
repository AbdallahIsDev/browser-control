import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryStore } from "../../memory_store";
import { loadAuthSnapshot, saveAuthSnapshotToStore, type AuthSnapshot } from "../../browser_auth_state";

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-auth-policy-"));
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--require", "ts-node/register", "--require", "tsconfig-paths/register", "cli.ts", ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function sampleSnapshot(profileId = "default"): AuthSnapshot {
  return {
    profileId,
    cookies: [
      {
        name: "session",
        value: "secret-cookie-value",
        domain: "example.test",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    localStorage: { "https://example.test": { token: "secret-local-storage-token" } },
    sessionStorage: {},
    capturedAt: new Date().toISOString(),
  };
}

test("safe policy blocks stored browser auth export", () => {
  const home = makeHome();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const outputPath = path.join(home, "auth-export.json");
  try {
    process.env.BROWSER_CONTROL_HOME = home;
    const store = new MemoryStore();
    saveAuthSnapshotToStore(store, "default", sampleSnapshot());
    store.close();

    const result = runCli(["browser", "auth", "export", outputPath, "--stored", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "safe",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /browser_auth_export|Policy|Confirmation required/);
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("safe policy blocks stored browser auth import", () => {
  const home = makeHome();
  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const inputPath = path.join(home, "auth-import.json");
  try {
    fs.writeFileSync(inputPath, JSON.stringify(sampleSnapshot("default")));

    const result = runCli(["browser", "auth", "import", inputPath, "--stored", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "safe",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /browser_auth_import|Policy|Confirmation required/);

    process.env.BROWSER_CONTROL_HOME = home;
    const store = new MemoryStore();
    const stored = loadAuthSnapshot(store, "default");
    store.close();
    assert.equal(stored, null);
  } finally {
    if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
    else process.env.BROWSER_CONTROL_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("safe policy blocks CLI debug bundle export", () => {
  const home = makeHome();
  try {
    const result = runCli(["debug", "bundle", "bundle-00000000-0000-4000-8000-000000000000", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "safe",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /debug_bundle_export|Policy|Confirmation required/);
    assert.doesNotMatch(result.stderr, /not found/i);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("safe policy blocks CLI debug console evidence read", () => {
  const home = makeHome();
  try {
    const result = runCli(["debug", "console", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "safe",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /debug_console_read|Policy|Confirmation required/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("safe policy blocks CLI debug network evidence read", () => {
  const home = makeHome();
  try {
    const result = runCli(["debug", "network", "--json"], {
      BROWSER_CONTROL_HOME: home,
      POLICY_PROFILE: "safe",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /debug_network_read|Policy|Confirmation required/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
