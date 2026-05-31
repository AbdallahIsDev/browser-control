import assert from "node:assert/strict";
import test from "node:test";

import { findAutomationBrowserPids } from "../../src/runtime/daemon_cleanup";

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
