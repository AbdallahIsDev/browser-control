import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  formatLaunchBrowserCommand,
  getLaunchBrowserScriptName,
} from "../../src/browser/launch_help";

describe("browser launch help", () => {
  it("suggests platform-specific browser launch scripts", () => {
    assert.equal(getLaunchBrowserScriptName("win32"), "launch_browser.bat");
    assert.equal(getLaunchBrowserScriptName("linux"), "scripts/launch_browser.sh");
    assert.equal(getLaunchBrowserScriptName("darwin"), "scripts/launch_browser.sh");
    assert.equal(formatLaunchBrowserCommand(9222, "win32"), "launch_browser.bat 9222");
    assert.equal(formatLaunchBrowserCommand(9222, "linux"), "scripts/launch_browser.sh 9222");
  });

  it("keeps user-facing generic launch guidance on the shared helper", () => {
    const files = [
      "src/main.ts",
      "src/operator/doctor.ts",
      "src/browser/actions.ts",
      "src/browser/connection.ts",
    ];

    for (const file of files) {
      const source = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      assert.match(
        source,
        /formatLaunchBrowserCommand/u,
        `${file} should use platform-aware launch guidance`,
      );
    }
  });
});
