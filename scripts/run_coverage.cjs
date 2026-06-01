#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const coverageDir = path.resolve(
  process.env.BROWSER_CONTROL_COVERAGE_DIR || path.join(root, "coverage", "v8"),
);
const runnerArgs =
  process.argv.length > 2 ? process.argv.slice(2) : [path.join("scripts", "run_active_tests.cjs")];

fs.rmSync(coverageDir, { recursive: true, force: true });
fs.mkdirSync(coverageDir, { recursive: true });

const result = spawnSync(process.execPath, runnerArgs, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_V8_COVERAGE: coverageDir,
  },
  windowsHide: true,
});

if (result.error) {
  console.error(result.error instanceof Error ? result.error.message : String(result.error));
  process.exit(1);
}

const files = fs.existsSync(coverageDir)
  ? fs.readdirSync(coverageDir).filter((entry) => entry.endsWith(".json"))
  : [];

if (result.status === 0 && files.length === 0) {
  console.error(`No V8 coverage artifacts were written to ${coverageDir}`);
  process.exit(1);
}

console.log(`Raw V8 coverage written to ${path.relative(os.homedir(), coverageDir) || coverageDir}`);
process.exit(result.status === null ? 1 : result.status);
