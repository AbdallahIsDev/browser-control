import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildDaemonSpawnOptions, resolveDaemonEntryPoint } from "./daemon_launch";

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
  assert.ok(path.basename(daemonArg).startsWith("daemon."));
});
