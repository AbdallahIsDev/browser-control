#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const runner = fs.readFileSync(path.join(root, "scripts", "run_active_tests.cjs"), "utf8");

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requireIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message);
  }
}

requireEqual(pkg.scripts.test, "node scripts/run_active_tests.cjs", "npm test must use active-test autodiscovery");
requireEqual(pkg.scripts["test:ci"], "node scripts/run_active_tests.cjs", "test:ci must match npm test");
requireEqual(pkg.scripts["test:coverage"], "node scripts/run_coverage.cjs", "coverage script must use V8 wrapper");
requireEqual(pkg.scripts["test:infra"], "node scripts/check_test_infra.cjs", "test infra check must stay runnable");

requireIncludes(runner, "testRoots", "active-test runner must declare discovered roots");
requireIncludes(runner, "collect(", "active-test runner must collect files dynamically");
requireIncludes(runner, "BROWSER_CONTROL_TEST_CONCURRENCY", "active-test runner must expose safe concurrency tuning");
requireIncludes(runner, "`--test-concurrency=${testConcurrency}`", "active-test runner must use configured concurrency");

console.log("Test infrastructure checks passed.");
