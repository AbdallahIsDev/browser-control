import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Telemetry, childProcessApi, createTelegramAlertHandler, resolvePowershellCmd } from "../../src/telemetry";

test("Telemetry records events, builds a summary, and exports reports", () => {
  const telemetry = new Telemetry();

  telemetry.record("smartClick", "success", 120, {
    selector: "#submit",
  });
  telemetry.record("captcha.solve", "success", 2_000, {
    kind: "recaptcha",
    tokenReceived: true,
  });
  telemetry.record("proxy.validate", "error", 900, {
    proxyUrl: "http://proxy.example.com:8080",
  });

  const summary = telemetry.getSummary();

  assert.equal(summary.totalSteps, 3);
  assert.equal(summary.successRate, 2 / 3);
  assert.equal(summary.captchasSolved, 1);
  assert.equal(summary.proxyUsage["http://proxy.example.com:8080"], 1);
  assert.equal(summary.screenshotsCaptured, 0);

  const markdown = telemetry.exportReport("markdown");
  const html = telemetry.exportReport("html");

  assert.match(markdown, /smartClick/);
  assert.match(html, /Telemetry Report/);
});

// ── Cross-platform PowerShell resolution ──────────────────────────────

test("resolvePowershellCmd returns 'powershell' on Windows", () => {
  assert.equal(resolvePowershellCmd("win32"), "powershell");
});

test("resolvePowershellCmd returns 'pwsh' on linux", () => {
  assert.equal(resolvePowershellCmd("linux"), "pwsh");
});

test("resolvePowershellCmd returns 'pwsh' on darwin", () => {
  assert.equal(resolvePowershellCmd("darwin"), "pwsh");
});

// ── Telegram alert handler ───────────────────────────────────────────

test("createTelegramAlertHandler returns silently when script is absent", () => {
  const handler = createTelegramAlertHandler("/nonexistent/path/notifier.ps1");
  // Should not throw
  handler({
    action: "test",
    result: "error",
    durationMs: 100,
    timestamp: new Date().toISOString(),
  });
});

test("createTelegramAlertHandler does not crash on spawn error", async (t) => {
  // Create a temp script file so the file-exists check passes,
  // then mock spawn to deterministically emit an error.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-alert-"));
  const scriptPath = path.join(tempDir, "notifier.ps1");
  fs.writeFileSync(scriptPath, 'Write-Host "test"');

  try {
    const fakeChild = {
      on(event: string, cb: (error?: Error) => void) {
        if (event === "error") {
          setImmediate(() => cb(new Error("spawn failed")));
        }
        return fakeChild;
      },
      unref() {
        return fakeChild;
      },
    };

    t.mock.method(childProcessApi, "spawn", () => fakeChild as unknown as ReturnType<typeof childProcessApi.spawn>);

    const handler = createTelegramAlertHandler(scriptPath);
    // This should NOT throw even when spawn emits an error.
    handler({
      action: "test.spawn-error",
      result: "error",
      durationMs: 50,
      timestamp: new Date().toISOString(),
      details: { reason: "test" },
    });

    // Give the child process a moment to potentially fail
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Telemetry saves reports and dispatches alerts for error events", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-test-"));
  const alerts: string[] = [];

  try {
    const telemetry = new Telemetry({
      reportsDir: tempDir,
    });

    telemetry.onAlert((event) => {
      alerts.push(event.action);
    });

    telemetry.record("task.fail", "error", 250, {
      reason: "network",
    });

    const reportPath = telemetry.saveReport("json");

    assert.equal(alerts[0], "task.fail");
    assert.equal(fs.existsSync(reportPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
