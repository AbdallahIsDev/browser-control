import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getLocalhostProxyStartupStatus,
  installLocalhostProxyStartup,
  uninstallLocalhostProxyStartup,
} from "../../src/services/startup";

test("localhost proxy startup install/status/uninstall writes only the requested startup file", () => {
  const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-startup-"));
  try {
    const options = {
      startupDir,
      command: "bc-test",
      port: 8080,
    };
    assert.equal(getLocalhostProxyStartupStatus(options).enabled, false);

    const installed = installLocalhostProxyStartup(options);
    assert.equal(installed.enabled, true);
    assert.ok(installed.filePath.startsWith(startupDir));
    const content = fs.readFileSync(installed.filePath, "utf8");
    assert.match(content, /bc-test/);
    assert.match(content, /service/);
    assert.match(content, /proxy/);
    assert.match(content, /8080/);

    const uninstalled = uninstallLocalhostProxyStartup(options);
    assert.equal(uninstalled.enabled, false);
    assert.equal(fs.existsSync(installed.filePath), false);
  } finally {
    fs.rmSync(startupDir, { recursive: true, force: true });
  }
});
