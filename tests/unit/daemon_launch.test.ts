import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDaemonSpawnOptions, resolveDaemonEntryPoint } from "../../src/runtime/daemon_launch";

test("buildDaemonSpawnOptions hides daemon windows by default on Windows", () => {
  const options = buildDaemonSpawnOptions({ cwd: process.cwd() }, "win32");
  assert.equal(options.windowsHide, true);
});

test("buildDaemonSpawnOptions allows visible daemon windows when requested on Windows", () => {
  const options = buildDaemonSpawnOptions({ cwd: process.cwd(), visible: true }, "win32");
  assert.equal(options.windowsHide, false);
});

test("buildDaemonSpawnOptions does not set windowsHide on non-Windows platforms", () => {
  const options = buildDaemonSpawnOptions({ cwd: process.cwd() }, "linux");
  assert.equal("windowsHide" in options, false);
});

test("resolveDaemonEntryPoint resolves a runnable daemon entrypoint", () => {
  const resolved = resolveDaemonEntryPoint(process.cwd());
  assert.equal(resolved.command, process.execPath);
  assert.ok(resolved.args.length >= 1);
  const daemonArg = resolved.args[resolved.args.length - 1];
  assert.ok(daemonArg);
  assert.match(daemonArg.replace(/\\/g, "/"), /(?:^|\/)(?:src\/)?(?:bin\/)?daemon\.(?:js|ts)$/u);
});

test("resolveDaemonEntryPoint resolves a compiled package daemon bin from package root", () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bc-daemon-entry-"));
  try {
    const distBinDir = path.join(packageRoot, "dist", "bin");
    fs.mkdirSync(distBinDir, { recursive: true });
    const daemonJs = path.join(distBinDir, "daemon.js");
    fs.writeFileSync(daemonJs, "");

    const resolved = resolveDaemonEntryPoint(packageRoot);

    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [daemonJs]);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("resolveDaemonEntryPoint resolves when cwd is compiled dist directory", () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bc-daemon-entry-"));
  try {
    const distBinDir = path.join(packageRoot, "dist", "bin");
    fs.mkdirSync(distBinDir, { recursive: true });
    const daemonJs = path.join(distBinDir, "daemon.js");
    fs.writeFileSync(daemonJs, "");

    const resolved = resolveDaemonEntryPoint(path.join(packageRoot, "dist"));

    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [daemonJs]);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("resolveDaemonEntryPoint resolves source bin from src cwd", () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bc-daemon-entry-"));
  try {
    const sourceBinDir = path.join(packageRoot, "src", "bin");
    fs.mkdirSync(sourceBinDir, { recursive: true });
    const daemonTs = path.join(sourceBinDir, "daemon.ts");
    fs.writeFileSync(daemonTs, "");

    const resolved = resolveDaemonEntryPoint(path.join(packageRoot, "src"));

    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [require.resolve("ts-node/dist/bin.js"), daemonTs]);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
});

test("resolveDaemonEntryPoint resolves source bin from package root before library shims", () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bc-daemon-entry-"));
  try {
    const sourceBinDir = path.join(packageRoot, "src", "bin");
    fs.mkdirSync(sourceBinDir, { recursive: true });
    const daemonTs = path.join(sourceBinDir, "daemon.ts");
    fs.writeFileSync(daemonTs, "");
    fs.writeFileSync(path.join(packageRoot, "src", "daemon.ts"), "export * from './runtime/daemon';");

    const resolved = resolveDaemonEntryPoint(packageRoot);

    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [require.resolve("ts-node/dist/bin.js"), daemonTs]);
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
});
