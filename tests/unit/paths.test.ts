import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  getSessionRuntimeDir,
  getSessionScreenshotsDir,
} from "../../src/shared/paths";

describe("runtime paths", () => {
  it("keeps legacy session-id paths when no metadata is provided", () => {
    const home = path.join(os.tmpdir(), "bc-paths-legacy");
    const sessionId = "da450474-35e7-452a-bfec-5a8ff9ee6257";

    assert.equal(
      getSessionRuntimeDir(sessionId, home),
      path.join(home, "runtime", sessionId),
    );
  });

  it("uses date and readable session folders when metadata is provided", () => {
    const home = path.join(os.tmpdir(), "bc-paths-readable");
    const sessionId = "da450474-35e7-452a-bfec-5a8ff9ee6257";
    const createdAt = new Date(2026, 3, 29, 0, 32, 14).toISOString();

    assert.equal(
      getSessionRuntimeDir(sessionId, home, {
        name: "MCP Managed X Test!",
        createdAt,
      }),
      path.join(home, "runtime", "2026-04-29", "00-32_mcp-managed-x-test_da450474"),
    );
  });

  it("writes a manifest for readable runtime folders", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-paths-manifest-"));
    const sessionId = "da450474-35e7-452a-bfec-5a8ff9ee6257";
    const createdAt = new Date(2026, 3, 29, 12, 5, 30).toISOString();

    try {
      const screenshotsDir = getSessionScreenshotsDir(sessionId, home, {
        name: "Manual X Test",
        createdAt,
      });
      const manifestPath = path.join(path.dirname(screenshotsDir), "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      assert.equal(screenshotsDir, path.join(
        home,
        "runtime",
        "2026-04-29",
        "12-05_manual-x-test_da450474",
        "screenshots",
      ));
      assert.equal(manifest.sessionId, sessionId);
      assert.equal(manifest.name, "Manual X Test");
      assert.equal(manifest.folderName, "12-05_manual-x-test_da450474");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("prefers an existing legacy folder for backward compatibility", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-paths-compat-"));
    const sessionId = "da450474-35e7-452a-bfec-5a8ff9ee6257";
    const legacyDir = path.join(home, "runtime", sessionId);
    fs.mkdirSync(legacyDir, { recursive: true });

    try {
      assert.equal(
        getSessionRuntimeDir(sessionId, home, {
          name: "MCP Managed X Test",
          createdAt: new Date(2026, 3, 29, 0, 32, 14).toISOString(),
        }),
        legacyDir,
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
