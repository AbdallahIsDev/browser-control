#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

fs.rmSync(path.resolve(__dirname, "..", "dist"), { recursive: true, force: true });
fs.mkdirSync(path.resolve(__dirname, "..", "dist"), { recursive: true });
for (const asset of ["wsl_cdp_bridge.cjs", "telegram_notifier.ps1"]) {
  const src = path.resolve(__dirname, "..", asset);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.resolve(__dirname, "..", "dist", asset));
  }
}
