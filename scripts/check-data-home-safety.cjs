#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const HOME = path.resolve(os.homedir());
const MARKER_FILENAME = "manifest.json";
const BC_HOME_DEFAULT = path.join(HOME, ".browser-control");
const QUARANTINE_DIR = path.join(HOME, "_browser-control-home-spill-20260517");

let exitCode = 0;

function fail(msg) {
  console.error("FAIL: " + msg);
  exitCode = 1;
}

function pass(msg) {
  console.log("PASS: " + msg);
}

// 1. Check configured data home is safe
const configuredHome = process.env.BROWSER_CONTROL_HOME;
if (configuredHome) {
  const resolved = path.resolve(configuredHome);
  const normalized = resolved.toLowerCase().replace(/[/\\]+$/, "");
  const normalizedHome = HOME.toLowerCase().replace(/[/\\]+$/, "");
  if (normalized === normalizedHome) {
    fail(`BROWSER_CONTROL_HOME is set to user home root: ${resolved}`);
  } else {
    pass(`BROWSER_CONTROL_HOME is safe: ${resolved}`);
  }
} else {
  pass("BROWSER_CONTROL_HOME is not set (defaults to ~/.browser-control)");
}

// 2. Check default home dir exists and is not root
if (fs.existsSync(BC_HOME_DEFAULT)) {
  const stat = fs.statSync(BC_HOME_DEFAULT);
  if (stat.isDirectory()) {
    pass(`Default data home exists: ${BC_HOME_DEFAULT}`);
  }
} else {
  pass(`Default data home not yet created (ok): ${BC_HOME_DEFAULT}`);
}

// 3. Check no BC marker exists directly under homedir
const markerPath = path.join(HOME, MARKER_FILENAME);
if (fs.existsSync(markerPath)) {
  try {
    const content = fs.readFileSync(markerPath, "utf8");
    const parsed = JSON.parse(content);
    if (parsed.product === "browser-control") {
      fail(`BC manifest.json found directly under homedir: ${markerPath}`);
    } else {
      pass(`File exists at homedir root but is not a BC marker: ${markerPath}`);
    }
  } catch {
    pass(`Non-JSON file at homedir root (not BC marker): ${markerPath}`);
  }
} else {
  pass("No BC manifest.json found directly under homedir");
}

// 4. Check common BC subdirs are not directly under homedir
//    This must fail if ANY exist, even if empty.
const spillDirs = [
  "state", "memory", "browser", "reports", "runtime",
  "config", "cache", "secrets", "helpers", "packages",
  "policy", "workflows", "trading", "evidence", "knowledge",
  "services", "providers", "skills", "backups", "automations",
  "interop", ".interop",
];
let foundSpill = false;
for (const dir of spillDirs) {
  const fullPath = path.join(HOME, dir);
  if (fs.existsSync(fullPath)) {
    // Any BC subdirectory at home root is a spill, even if empty.
    // A non-empty dir confirms it, but even empty dirs are not
    // supposed to exist directly under the user home.
    fail(`BC subdirectory found directly under homedir: ${fullPath}`);
    foundSpill = true;
  }
}
if (!foundSpill) {
  pass("No BC subdirectories found directly under homedir");
}

// 5. Check quarantine exists if there was spill
if (fs.existsSync(QUARANTINE_DIR)) {
  const entries = fs.readdirSync(QUARANTINE_DIR);
  if (entries.length > 0) {
    pass(`Quarantine directory exists with ${entries.length} items: ${QUARANTINE_DIR}`);
  } else {
    pass(`Quarantine directory exists (empty): ${QUARANTINE_DIR}`);
  }
} else {
  pass("No quarantine directory (no home spill was found)");
}

console.log("");
if (exitCode === 0) {
  console.log("Data home safety check PASSED");
} else {
  console.log("Data home safety check FAILED");
}
process.exit(exitCode);
