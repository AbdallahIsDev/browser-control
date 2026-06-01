#!/usr/bin/env node
"use strict";

const MIN_NODE_MAJOR = 22;
const currentNodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0] || "", 10);

if (!Number.isFinite(currentNodeMajor) || currentNodeMajor < MIN_NODE_MAJOR) {
  console.error(
    `Browser Control launch_browser requires Node.js >=${MIN_NODE_MAJOR}. Current Node.js: ${process.versions.node}.`,
  );
  process.exit(1);
}

require("ts-node").register({ project: require("path").resolve(__dirname, "..", "tsconfig.json"), transpileOnly: true });

const mod = require("../src/runtime/launch_browser");

if (require.main === module) {
  // Running directly — invoke main()
  mod._main().catch(function (error) {
    console.error("Launch failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = mod;
