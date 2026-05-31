import assert from "node:assert/strict";
import test from "node:test";

import {
  findAutomationBrowserPids,
  isWindowsProcessStartConsistentWithDaemonStatus,
  parseWindowsProcessIdentity,
  parseWmicCreationTimeMs,
} from "../../src/runtime/daemon_cleanup";

test("findAutomationBrowserPids matches POSIX Browser Control browser processes only", () => {
  const output = [
    " 1234 /usr/bin/chromium --remote-debugging-port=9222 --user-data-dir=/home/user/.browser-control/browser/profiles/default",
    " 2345 /usr/bin/chromium --remote-debugging-port=9222 --user-data-dir=/home/user/regular-profile",
    " 3456 /usr/bin/firefox --remote-debugging-port=9222 --user-data-dir=/home/user/.browser-control/browser/profiles/default",
    " 4567 /usr/bin/chromium --user-data-dir=/home/user/.browser-control/browser/profiles/default",
  ].join("\n");

  assert.deepEqual(findAutomationBrowserPids(output), [1234]);
});

test("findAutomationBrowserPids scopes POSIX matches to an explicit data home", () => {
  const output = [
    " 1111 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/bc-a/browser/profiles/default",
    " 2222 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/bc-b/browser/profiles/default",
  ].join("\n");

  assert.deepEqual(findAutomationBrowserPids(output, "/tmp/bc-b"), [2222]);
});

test("parseWindowsProcessIdentity extracts process creation time from WMIC CSV", () => {
  const output = [
    "Node,CommandLine,CreationDate,ProcessId",
    "HOST,C:\\Program Files\\nodejs\\node.exe C:\\repo\\browser-control\\dist\\daemon.js,20260531123015.000000+180,4321",
  ].join("\r\n");

  const identity = parseWindowsProcessIdentity(output, 4321);

  assert.ok(identity);
  assert.match(identity.commandLine, /daemon\.js/);
  assert.equal(identity.creationTimeMs, Date.UTC(2026, 4, 31, 9, 30, 15));
});

test("Windows daemon PID verification rejects likely PID reuse", () => {
  const originalDaemonStart = "2026-05-31T09:30:20.000Z";
  const originalProcessStart = parseWmicCreationTimeMs("20260531123015.000000+180");
  const reusedProcessStart = parseWmicCreationTimeMs("20260531124500.000000+180");

  assert.equal(
    isWindowsProcessStartConsistentWithDaemonStatus(
      originalProcessStart ?? undefined,
      originalDaemonStart,
    ),
    true,
  );
  assert.equal(
    isWindowsProcessStartConsistentWithDaemonStatus(
      reusedProcessStart ?? undefined,
      originalDaemonStart,
    ),
    false,
  );
});
