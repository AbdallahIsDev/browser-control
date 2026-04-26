#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const nodeCmd = process.execPath;

function findNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(process.env.APPDATA ?? "", "npm", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    const detail = [
      `Command failed: ${command} ${args.join(" ")}`,
      `Exit: ${result.status}`,
      result.error ? `error: ${result.error.message}` : "",
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n");
    throw new Error(detail);
  }

  return result;
}

function runNpm(args, options = {}) {
  const npmCli = findNpmCli();
  if (npmCli) {
    return run(nodeCmd, [npmCli, ...args], options);
  }
  return run("npm", args, options);
}

function runJson(command, args, options = {}) {
  const result = run(command, args, options);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Expected JSON from ${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

let tarballPath = "";
let tempProject = "";
let tempHome = "";

try {
  runNpm(["run", "build"]);

  const packOutput = runNpm(["pack", "--json"]).stdout;
  const packInfo = JSON.parse(packOutput)[0];
  const packedFiles = new Set((packInfo.files ?? []).map((file) => file.path));
  for (const forbidden of ["dist/test_daemon_helpers.js", "dist/test_daemon_helpers.d.ts", "dist/tests/"]) {
    if (packedFiles.has(forbidden)) throw new Error(`Packed tarball unexpectedly includes ${forbidden}`);
  }
  tarballPath = path.join(root, packInfo.filename);

  tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "bc-package-smoke-project-"));
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-package-smoke-home-"));

  runNpm(["init", "-y"], { cwd: tempProject });
  runNpm(["install", tarballPath, "--no-audit", "--fund=false"], { cwd: tempProject });

  const env = {
    ...process.env,
    BROWSER_CONTROL_HOME: tempHome,
    BROKER_PORT: String(31000 + Math.floor(Math.random() * 2000)),
    LOG_LEVEL: "error",
    LOG_FILE: "false",
  };

  const cliPath = path.join(tempProject, "node_modules", "browser-control", "cli.js");
  run(nodeCmd, ["-e", "const bc=require('browser-control'); if (typeof bc.createBrowserControl !== 'function') throw new Error('missing createBrowserControl');"], { cwd: tempProject, env });

  const help = run(nodeCmd, [cliPath, "--help"], { cwd: tempProject, env });
  if (!help.stdout.includes("Browser Control CLI")) {
    throw new Error(`Installed CLI help output looked wrong:\n${help.stdout}`);
  }

  const setup = runJson(nodeCmd, [cliPath, "setup", "--non-interactive", "--json"], { cwd: tempProject, env });
  if (setup.success !== true || setup.dataHome !== tempHome) {
    throw new Error(`Unexpected setup result: ${JSON.stringify(setup)}`);
  }

  const doctor = runJson(nodeCmd, [cliPath, "doctor", "--json"], { cwd: tempProject, env });
  if (!doctor.summary || typeof doctor.summary.criticalFailures !== "number") {
    throw new Error(`Unexpected doctor result: ${JSON.stringify(doctor)}`);
  }

  const status = runJson(nodeCmd, [cliPath, "status", "--json"], { cwd: tempProject, env });
  if (!status.daemon || status.dataHome !== tempHome) {
    throw new Error(`Unexpected status result: ${JSON.stringify(status)}`);
  }

  const binHelp = process.platform === "win32"
    ? runNpm(["exec", "--", "bc", "--help"], { cwd: tempProject, env })
    : run(path.join(tempProject, "node_modules", ".bin", "bc"), ["--help"], { cwd: tempProject, env });
  if (!binHelp.stdout.includes("Browser Control CLI")) {
    throw new Error(`Installed bc bin help output looked wrong:\n${binHelp.stdout}`);
  }

  console.log(JSON.stringify({
    success: true,
    package: packInfo.name,
    version: packInfo.version,
    tempProject,
    dataHome: tempHome,
  }));
} finally {
  if (tempProject) fs.rmSync(tempProject, { recursive: true, force: true });
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  if (tarballPath) fs.rmSync(tarballPath, { force: true });
}
