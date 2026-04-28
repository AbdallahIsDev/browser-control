#!/usr/bin/env node

// CLI entry point — works in both compiled (dist/) and development (ts-node) modes.
//
// When running from a published install, `dist/cli.js` is the real entry and
// this file is a thin shim.  When running from the repo with ts-node, this
// file bootstraps the TypeScript compiler and loads cli.ts directly.

const path = require("node:path");
const fs = require("node:fs");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  console.error(`Browser Control requires Node.js >=22. Current Node.js: ${process.versions.node}.`);
  process.exit(1);
}

const distCli = path.join(__dirname, "dist", "cli.js");
const hasTsRuntime = Boolean(require.extensions[".ts"]);

if (!hasTsRuntime && fs.existsSync(distCli)) {
  // Compiled build exists — delegate to it
  const cli = require(distCli);
  module.exports = cli;

  if (require.main === module) {
    cli.runCli().catch((error) => {
      console.error("Fatal error:", error.message);
      process.exit(1);
    });
  }
} else {
  // Development mode — bootstrap ts-node and load the TypeScript source
  require("ts-node").register({
    project: "./tsconfig.json",
    transpileOnly: true,
  });

  const cli = require("./src/cli.ts");
  module.exports = cli;

  // Run CLI if this file is executed directly
  if (require.main === module) {
    cli.runCli().catch((error) => {
      console.error("Fatal error:", error.message);
      process.exit(1);
    });
  }
}
