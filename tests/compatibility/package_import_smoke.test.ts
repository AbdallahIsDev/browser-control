import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("public package entry imports built package exports", async () => {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"], {
    cwd: process.cwd(),
    stdio: "pipe",
    shell: false,
  });

  const distIndex = path.join(process.cwd(), "dist", "index.js");
  const distTypes = path.join(process.cwd(), "dist", "index.d.ts");
  assert.ok(fs.existsSync(distIndex), "dist/index.js should exist after build.");
  assert.ok(fs.existsSync(distTypes), "dist/index.d.ts should exist after build.");

  const requiredExports = [
    "createBrowserControl",
    "successResult",
    "failureResult",
    "formatActionResult",
    "buildToolRegistry",
    "loadConfig",
  ];
  const script = `
    const api = require(".");
    const required = ${JSON.stringify(requiredExports)};
    for (const name of required) {
      if (typeof api[name] !== "function") {
        throw new Error("Expected public export " + name);
      }
    }
  `;
  execFileSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});

test("published CLI shim can show help after build", () => {
  const output = execFileSync(process.execPath, ["cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.match(output, /Browser Control CLI/);
  assert.match(output, /mcp serve/);
});

test("package exposes bc binary", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

  assert.equal(manifest.bin.bc, "./cli.js");
});
