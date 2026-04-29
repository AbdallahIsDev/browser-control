import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { snapshot } from "../../src/a11y_snapshot";
import { parseArgs } from "../../src/cli";
import { ScreencastRecorder } from "../../src/observability/screencast";
import { OBSERVABILITY_KEYS } from "../../src/observability/types";
import { MemoryStore } from "../../src/runtime/memory_store";
import { resolveChromePath } from "../../src/runtime/launch_browser";

const repoRoot = path.resolve(__dirname, "../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("snapshot boxes survive null Playwright viewport metadata", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromePath(process.platform, process.env.BROWSER_CHROME_PATH),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button id="confirm" style="width: 120px; height: 40px">Confirm</button>`);
    Object.defineProperty(page, "viewportSize", {
      value: () => null,
    });

    const snap = await snapshot(page, { sessionId: "browser-features", boxes: true });
    const button = snap.elements.find((element) => element.role === "button" && element.name === "Confirm");

    assert.ok(button?.bounds, "button should include bounds");
    assert.equal(typeof button.bounds.viewportWidth, "number");
    assert.equal(typeof button.bounds.viewportHeight, "number");
    assert.equal(typeof button.bounds.deviceScaleFactor, "number");
  } finally {
    await browser.close();
  }
});

test("screencast state and timeline restore across recorder instances", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-browser-features-screencast-"));
  const store = new MemoryStore({ filename: path.join(home, "memory.sqlite") });
  try {
    const first = new ScreencastRecorder({ store });
    const session = await first.start({
      browserSessionId: "session-regression",
      pageId: "page-regression",
      options: { retention: "keep" },
    });
    first.appendEvent({
      timestamp: new Date().toISOString(),
      action: "click",
      target: "@e1",
      url: "https://example.test",
      success: true,
    });

    const second = new ScreencastRecorder({ store });
    assert.equal(second.status()?.id, session.id);

    const stopped = await second.stop(true);
    assert.equal(stopped.session.status, "stopped");
    assert.ok(stopped.timelinePath, "timeline should be written from restored memory store events");

    const timeline = JSON.parse(fs.readFileSync(stopped.timelinePath!, "utf8"));
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].action, "click");
  } finally {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("debug-only retention removes success artifacts", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-browser-features-retention-"));
  const oldHome = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = home;
  try {
    const store = new MemoryStore({ filename: path.join(home, "memory.sqlite") });
    try {
      const recorder = new ScreencastRecorder({ store });
      const session = await recorder.start({
        browserSessionId: "session-retention",
        pageId: "page-retention",
        options: { retention: "debug-only" },
      });
      fs.writeFileSync(session.path, "fake video");

      const stopped = await recorder.stop(true);
      assert.equal(stopped.session.retention, "debug-only");
      assert.equal(fs.existsSync(session.path), false);
    } finally {
      store.close();
    }
  } finally {
    if (oldHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = oldHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI drop parser preserves repeated file flags and mime=value data", () => {
  const parsed = parseArgs([
    "node",
    "src/cli.ts",
    "browser",
    "drop",
    "@e1",
    "--file",
    "C:\\tmp\\one.txt",
    "--files",
    "C:\\tmp\\two.txt",
    "--data",
    "text/plain=hello:world=a=b",
    "--data=application/json={\"url\":\"https://example.test?a=1:b\"}",
  ]);

  assert.equal(parsed.flags.file, "C:\\tmp\\one.txt");
  assert.equal(parsed.flags.files, "C:\\tmp\\two.txt");
  assert.equal(
    parsed.flags.data,
    "text/plain=hello:world=a=b\0application/json={\"url\":\"https://example.test?a=1:b\"}",
  );
});

test("source guards cover prior browser feature review regressions", () => {
  const screencast = readSource("src/observability/screencast.ts");
  const actions = readSource("src/browser/actions.ts");
  const cli = readSource("src/cli.ts");
  const snapshotSource = readSource("src/a11y_snapshot.ts");
  const connection = readSource("src/browser/connection.ts");
  const provider = readSource("src/providers/local.ts");
  const browserControl = readSource("src/browser_control.ts");

  assert.match(screencast, /constructor\(options\?: \{ store\?: MemoryStore \}/);
  assert.match(screencast, /const session = this\.status\(\);/);
  assert.match(screencast, /this\.store\.keys\(OBSERVABILITY_KEYS\.screencastPrefix\)/);
  assert.match(screencast, /await this\.applyRetention\(session, success\);/);
  assert.match(screencast, /this\.frameCaptureInterval\.unref\?\.\(\);/);
  assert.match(screencast, /data-browser-control-screencast-root/);

  assert.match(actions, /recordTimelineEvent\(\{/);
  assert.match(actions, /data: droppedData\.length > 0 \? droppedData\.map/);
  assert.match(actions, /\[REDACTED: \$\{d\.value\.length\} characters\]/);
  assert.match(actions, /const safeStyleProperties = \[/);
  assert.doesNotMatch(actions, /background-image/);
  assert.match(actions, /overlay\.style\.pointerEvents = 'none'/);
  assert.match(actions, /data-browser-control-annotation-root/);

  assert.match(cli, /const fileValues = \[flags\.file, flags\.files\]/);
  assert.match(cli, /const filesRaw = fileValues\.length > 0 \? fileValues\.join\("\\0"\) : undefined/);
  assert.match(cli, /const eqIndex = d\.indexOf\("="\)/);
  assert.match(cli, /getGlobalScreencastRecorder\(store\)/);

  assert.match(snapshotSource, /viewportInfo = await page\.evaluate\(\(\) => \(\{/);
  assert.match(snapshotSource, /width: window\.innerWidth/);
  assert.match(connection, /typeof browser\.once !== "function"/);
  assert.match(provider, /options\.all[\s\S]*9229/);
  assert.match(browserControl, /getGlobalScreencastRecorder\(sessionManager\.getMemoryStore\(\)\)/);

  assert.ok(OBSERVABILITY_KEYS.receiptPrefix.length > 0);
});
