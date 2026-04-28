import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import { exec, execStdout, execTest, ExecError } from "../../src/terminal_exec";

function echoCommand(): string {
  return os.platform() === "win32"
    ? 'Write-Output "hello"'
    : 'printf "hello\\n"';
}

function successCommand(): string {
  return os.platform() === "win32"
    ? 'Write-Output "ok"'
    : "true";
}

function failureCommand(): string {
  return os.platform() === "win32"
    ? 'throw "boom"'
    : 'echo "boom" 1>&2; exit 1';
}

function slowCommand(): string {
  return os.platform() === "win32"
    ? "Start-Sleep -Seconds 5"
    : "sleep 5";
}

test("terminal_exec: exec runs a simple command successfully", async () => {
  const result = await exec(echoCommand());
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("hello"));
  assert.ok(result.durationMs >= 0);
  assert.ok(result.cwd.length > 0);
  assert.equal(result.attempts, 1);
});

test("terminal_exec: execStdout returns only stdout", async () => {
  const output = await execStdout(os.platform() === "win32" ? 'Write-Output "test-output"' : 'printf "test-output\\n"');
  assert.ok(output.includes("test-output"));
});

test("terminal_exec: execTest returns true for successful commands", async () => {
  const success = await execTest(successCommand());
  assert.equal(success, true);
});

test("terminal_exec: execTest returns false for failed commands", async () => {
  const success = await execTest(failureCommand());
  assert.equal(success, false);
});

test("terminal_exec: exec throws ExecError on failure by default", async () => {
  await assert.rejects(
    () => exec(failureCommand()),
    (error: unknown) => error instanceof ExecError,
  );
});

test("terminal_exec: exec does not throw when throwOnFailure is false", async () => {
  const result = await exec(failureCommand(), { throwOnFailure: false });
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 1);
});

test("terminal_exec: exec respects timeout", async () => {
  const result = await exec(slowCommand(), {
    timeoutMs: 500,
    throwOnFailure: false,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 124);
});
