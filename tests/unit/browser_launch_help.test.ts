import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { formatLaunchBrowserCommand } from "../../src/browser/launch_help";

describe("browser launch help", () => {
  it("returns npm-safe browser launch commands", () => {
    assert.equal(formatLaunchBrowserCommand(9222, "win32"), "bc browser launch --port 9222");
    assert.equal(formatLaunchBrowserCommand(9222, "linux"), "bc browser launch --port 9222");
    assert.equal(formatLaunchBrowserCommand(undefined, "linux"), "bc browser launch");
  });

  it("does not keep checkout-only launcher script names in the user guidance helper", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../..", "src/browser/launch_help.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /launch_browser\.bat/u);
    assert.doesNotMatch(source, /scripts\/launch_browser\.sh/u);
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

  it("keeps WSL connection recovery guidance npm-safe and user-port aware", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../..", "src/browser/connection.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /C:\\Users\\11\\browser-control/u);
    assert.doesNotMatch(source, /node cli\.js browser attach/u);
    assert.doesNotMatch(source, /launch_browser\.bat \$\{port\}/u);
    assert.match(source, /formatLaunchBrowserCommand\(port\)/u);
    assert.match(source, /browser attach --port \$\{port\} --yes/u);
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
