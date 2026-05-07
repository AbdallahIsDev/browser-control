#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const testRoots = [
  path.join(root, "tests", "unit"),
  path.join(root, "tests", "compatibility"),
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

const args = [
  "--require", "ts-node/register",
  "--require", "tsconfig-paths/register",
  "--test",
  "--test-concurrency=1",
  ...files,
];

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
