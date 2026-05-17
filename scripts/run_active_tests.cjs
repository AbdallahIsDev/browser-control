#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

// Sanitize environment: strip unsafe BROWSER_CONTROL_HOME and ALLOW_UNSAFE
// env vars so tests never inherit a data-home pointing at the user's home root.
const os = require("node:os");
const testEnv = { ...process.env };
delete testEnv.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
if (testEnv.BROWSER_CONTROL_HOME) {
  const normalizedHome = path.resolve(testEnv.BROWSER_CONTROL_HOME).toLowerCase().replace(/[/\\]+$/, "");
  const normalizedOsHome = path.resolve(os.homedir()).toLowerCase().replace(/[/\\]+$/, "");
  if (normalizedHome === normalizedOsHome) {
    delete testEnv.BROWSER_CONTROL_HOME;
    console.error("INFO: Stripped unsafe BROWSER_CONTROL_HOME from test env (was set to user home root)");
  }
}

const testRoots = [
  path.join(root, "tests", "unit"),
  path.join(root, "tests", "compatibility"),
  path.join(root, "tests", "integration"),
];

function collect(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(fullPath, output);
    else if (/\.test\.ts$/u.test(entry.name)) output.push(fullPath);
  }
  return output;
}

const files = testRoots.flatMap((dir) => collect(dir)).sort();
if (files.length === 0) {
  console.error("No active tests found.");
  process.exit(1);
}

const failed = [];
const total = files.length;

for (let i = 0; i < files.length; i++) {
  const abs = files[i];
  const rel = path.relative(root, abs);
  const start = Date.now();

  process.stdout.write(`[${i + 1}/${total}] RUN ${rel} ... `);

  const result = spawnSync(
    process.execPath,
    [
      "--require", "ts-node/register",
      "--require", "tsconfig-paths/register",
      "--test",
      "--test-concurrency=1",
      "--test-timeout=120000",
      abs,
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: testEnv,
    },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (result.status === 0) {
    console.log(`PASS (${elapsed}s)`);
  } else {
    console.log(`FAIL (${elapsed}s)`);
    failed.push(rel);
  }
}

console.log("");
if (failed.length > 0) {
  console.log(`FAILED (${failed.length}/${total}):`);
  for (const f of failed) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
} else {
  console.log(`ALL ${total} PASSED`);
  process.exit(0);
}
