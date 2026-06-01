import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  formatLaunchBrowserCommand,
  getLaunchBrowserScriptName,
} from "../../src/browser/launch_help";

describe("browser launch help", () => {
  it("keeps developer script names separate from npm-safe user guidance", () => {
    assert.equal(getLaunchBrowserScriptName("win32"), "launch_browser.bat");
    assert.equal(getLaunchBrowserScriptName("linux"), "scripts/launch_browser.sh");
    assert.equal(getLaunchBrowserScriptName("darwin"), "scripts/launch_browser.sh");
    assert.equal(formatLaunchBrowserCommand(9222, "win32"), "bc browser launch --port 9222");
    assert.equal(formatLaunchBrowserCommand(9222, "linux"), "bc browser launch --port 9222");
    assert.equal(formatLaunchBrowserCommand(undefined, "linux"), "bc browser launch");
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
        `${file} should use npm-safe launch guidance`,
      );
    }
  });

  it("does not expose source-checkout launch scripts through the shared user-facing helper", () => {
    for (const platform of ["win32", "linux", "darwin"] as NodeJS.Platform[]) {
      const command = formatLaunchBrowserCommand(9222, platform);
      assert.doesNotMatch(command, /launch_browser|scripts\//u);
      assert.match(command, /^bc browser launch --port 9222$/u);
    }
  });

  it("quotes Windows launcher arguments before invoking node", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../..", "launch_browser.bat"),
      "utf8",
    );

    assert.match(
      source,
      /node "%~dp0scripts\\launch_browser\.cjs" "%PORT%" "%BIND_ADDRESS%"/u,
    );
    assert.doesNotMatch(
      source,
      /node "%~dp0scripts\\launch_browser\.cjs" %PORT% %BIND_ADDRESS%/u,
    );
  });
});
