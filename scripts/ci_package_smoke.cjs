#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const errors = [];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  const isNpmCli = npmExecPath && /(?:^|[\\/])npm(?:-cli)?\.js$/i.test(npmExecPath);
  if (isNpmCli && fs.existsSync(npmExecPath)) {
    return run(process.execPath, [npmExecPath, ...args], options);
  }
  return run(npmCmd, args, { ...options, shell: process.platform === "win32" });
}

function fail(message) {
  errors.push(message);
}

function walkFiles(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, result);
    } else {
      result.push(fullPath);
    }
  }
  return result;
}

console.log("Building package...");
runNpm(["run", "build"]);

const distDir = path.join(root, "dist");
for (const filePath of walkFiles(distDir).filter((file) => /\.(?:js|d\.ts)$/.test(file))) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("@bc/")) {
    fail(`Built file contains unresolved @bc path alias: ${path.relative(root, filePath)}`);
  }
}

console.log("Packing package...");
let packInfo;
let tarballPath = "";
const tarballsToRemove = [];
let tempProject = "";

try {
  const output = runNpm(["pack", "--json"]);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("npm pack --json did not return one package record");
  }
  packInfo = parsed[0];
  if (!packInfo.filename) {
    throw new Error("npm pack --json did not include a filename");
  }
  tarballPath = path.join(root, packInfo.filename);
  tarballsToRemove.push(tarballPath);

  const files = new Set((packInfo.files ?? []).map((file) => file.path.replace(/\\/g, "/")));

  const requiredFiles = [
    "package.json",
    "cli.js",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/wsl_cdp_bridge.cjs",
    "dist/telegram_notifier.ps1",
    "LICENSE",
    ".env.example",
  ];

  for (const file of requiredFiles) {
    if (!files.has(file)) {
      fail(`Package missing required file: ${file}`);
    }
  }

  const forbiddenPatterns = [
    /^\.worktrees(?:\/|$)/,
    /^node_modules(?:\/|$)/,
    /^screenshots(?:\/|$)/,
    /^reports(?:\/|$)/,
    /^\.env$/,
    /\.sqlite$/,
  ];

  for (const file of files) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(file)) {
        fail(`Package includes forbidden file: ${file}`);
      }
    }
  }

  if (!tarballPath || !fs.existsSync(tarballPath)) {
    fail(`Package tarball was not created: ${packInfo.filename}`);
  }

  if (errors.length === 0) {
    tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "bc-package-smoke-"));
    fs.writeFileSync(path.join(tempProject, "package.json"), JSON.stringify({ private: true }, null, 2));

    console.log("Installing packed artifact in temp project...");
    runNpm([
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      tarballPath,
    ], {
      cwd: tempProject,
    });

    const requireCheck = "const bc = require('browser-control'); if (typeof bc.createBrowserControl !== 'function') throw new Error('createBrowserControl export missing');";
    execFileSync(process.execPath, ["-e", requireCheck], {
      cwd: tempProject,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });

    const binPath = path.join(tempProject, "node_modules", ".bin", process.platform === "win32" ? "bc.cmd" : "bc");
    if (!fs.existsSync(binPath)) {
      fail(`Installed bin shim missing: ${binPath}`);
    }
    const cliPath = path.join(tempProject, "node_modules", "browser-control", "cli.js");
    if (errors.length === 0) {
      execFileSync(process.execPath, [cliPath, "--help"], {
        cwd: tempProject,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      });
    }
  }
} catch (error) {
  fail(`Package smoke error: ${error.message}`);
} finally {
  for (const file of tarballsToRemove) {
    if (file && fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
  if (tempProject && fs.existsSync(tempProject)) {
    fs.rmSync(tempProject, { recursive: true, force: true });
  }
}

if (errors.length > 0) {
  console.error("Package smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Package smoke passed: ${packInfo?.files?.length ?? 0} files checked.`);
