#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const productionDir = path.join(root, "docs", "production-upgrade");
const statusPath = path.join(productionDir, "STATUS.md");
const readmePath = path.join(productionDir, "README.md");
const rootReadmePath = path.join(root, "README.md");

const errors = [];

function exists(filePath) {
  return fs.existsSync(filePath);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

if (!exists(statusPath)) {
  errors.push("Missing docs/production-upgrade/STATUS.md");
}

let status = "";
if (exists(statusPath)) {
  status = read(statusPath);
}

const sectionRows = new Set();
let inSectionStatus = false;
for (const line of status.split(/\r?\n/)) {
  if (/^##\s+Section Status\b/.test(line)) {
    inSectionStatus = true;
    continue;
  }
  if (inSectionStatus && /^##\s+/.test(line)) {
    inSectionStatus = false;
  }
  if (!inSectionStatus) {
    continue;
  }

  const rowMatch = line.match(/^\|\s*(0?\d+)\s*\|/);
  if (rowMatch) {
    sectionRows.add(Number(rowMatch[1]));
  }
}

for (let section = 4; section <= 23; section += 1) {
  const sectionId = String(section).padStart(2, "0");
  const prefix = `section-${sectionId}-`;
  const dirs = exists(productionDir)
    ? fs.readdirSync(productionDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
        .map((entry) => entry.name)
    : [];

  if (dirs.length !== 1) {
    errors.push(`Expected exactly one docs/production-upgrade/${prefix}* folder, found ${dirs.length}`);
    continue;
  }

  const specPath = path.join(productionDir, dirs[0], "spec.md");
  if (!exists(specPath)) {
    errors.push(`Missing spec.md for ${dirs[0]}`);
  }

  if (status && !sectionRows.has(section)) {
    errors.push(`STATUS.md missing Section ${sectionId}`);
  }
}

for (let section = 17; section <= 23; section += 1) {
  if (status && !sectionRows.has(section)) {
    errors.push(`STATUS.md missing premium-readiness Section ${section}`);
  }
}

const readmeMentionsStatus = [readmePath, rootReadmePath].some((filePath) => {
  if (!exists(filePath)) return false;
  return /STATUS\.md/.test(read(filePath));
});

if (!readmeMentionsStatus) {
  errors.push("README.md or docs/production-upgrade/README.md must mention STATUS.md");
}

if (errors.length > 0) {
  console.error("Production status check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Production status check passed.");
