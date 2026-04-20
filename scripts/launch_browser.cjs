#!/usr/bin/env node
"use strict";

require("ts-node").register({ project: require("path").resolve(__dirname, "..", "tsconfig.json"), transpileOnly: true });

const mod = require("./launch_browser");

if (require.main === module) {
  // Running directly — invoke main()
  mod._main().catch(function (error) {
    console.error("Launch failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = mod;
