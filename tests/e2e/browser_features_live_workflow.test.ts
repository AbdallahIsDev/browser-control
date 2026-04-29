import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createBrowserControl } from "../../src/browser_control";
import { MemoryStore } from "../../src/runtime/memory_store";
import { getSessionDownloadsDir } from "../../src/shared/paths";
import { resolveChromePath } from "../../src/runtime/launch_browser";
import { resetGlobalScreencastRecorder } from "../../src/observability/screencast";

type TimelineEvent = {
  action: string;
  target?: string;
  success?: boolean;
};

function canLaunchChrome(): boolean {
  try {
    resolveChromePath(process.platform, process.env.BROWSER_CHROME_PATH);
    return true;
  } catch {
    return false;
  }
}

function assertOk<T>(result: { success: boolean; data?: T; error?: string }, label: string): T {
  assert.equal(result.success, true, `${label} failed: ${result.error ?? "unknown error"}`);
  assert.ok(result.data, `${label} returned no data`);
  return result.data;
}

test("browser feature live workflow drives spatial, screencast, drop, screenshot, and downloads APIs", async (t) => {
  if (process.env.BC_SKIP_LIVE_BROWSER_TESTS === "1") {
    t.skip("BC_SKIP_LIVE_BROWSER_TESTS=1");
    return;
  }
  if (!canLaunchChrome()) {
    t.skip("Chrome executable not found. Set BROWSER_CHROME_PATH to run live browser workflow.");
    return;
  }

  const previousHome = process.env.BROWSER_CONTROL_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-browser-features-live-"));
  process.env.BROWSER_CONTROL_HOME = home;
  resetGlobalScreencastRecorder();

  const store = new MemoryStore({ filename: path.join(home, "memory.sqlite") });
  const bc = createBrowserControl({
    memoryStore: store,
    policyProfile: "trusted",
    workingDirectory: home,
  });

  try {
    const session = assertOk(await bc.session.create("browser-features-live", {
      policyProfile: "trusted",
      workingDirectory: home,
    }), "session create");

    const fixtureFile = path.join(home, "fixture-upload.txt");
    fs.writeFileSync(fixtureFile, "upload fixture");

    const downloadsDir = getSessionDownloadsDir(session.id);
    fs.mkdirSync(downloadsDir, { recursive: true });
    const downloadedPath = path.join(downloadsDir, "already-downloaded.txt");
    fs.writeFileSync(downloadedPath, "download fixture");

    const html = `<!doctype html>
      <title>Browser Feature Live Workflow</title>
      <main>
        <label for="name">Name</label>
        <input id="name" aria-label="Name" />
        <button id="confirm" onclick="document.body.dataset.clicked = 'yes'">Confirm</button>
        <input id="file" type="file" />
        <div id="drop-zone" role="button" tabindex="0" style="width:160px;height:60px;border:1px solid #333">
          Drop zone
        </div>
        <output id="drop-output"></output>
      </main>
      <script>
        document.getElementById('drop-zone').addEventListener('drop', event => {
          event.preventDefault();
          document.getElementById('drop-output').textContent = event.dataTransfer.getData('text/plain');
        });
        document.getElementById('drop-zone').addEventListener('dragover', event => event.preventDefault());
      </script>`;
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    assertOk(await bc.browser.open({ url }), "open");

    const snapshot = assertOk(await bc.browser.snapshot({ boxes: true }), "snapshot boxes");
    const button = snapshot.elements.find((element) => element.role === "button" && element.name === "Confirm");
    assert.ok(button?.ref, "snapshot should expose button ref");
    assert.ok(button.bounds, "snapshot should expose button bounds");
    assert.equal(typeof button.bounds.viewportWidth, "number");

    assertOk(await bc.browser.screencast.start({
      showActions: true,
      retention: "keep",
    }), "screencast start");

    assertOk(await bc.browser.fill({ target: "#name", text: "Ada", commit: true }), "fill");
    assertOk(await bc.browser.click({ target: "#confirm" }), "click");

    const dropData = assertOk(await bc.browser.drop({
      target: "#drop-zone",
      data: [{ mimeType: "text/plain", value: "token:abc=123" }],
    }), "data drop");
    assert.equal(dropData.data?.[0]?.mimeType, "text/plain");
    assert.match(dropData.data?.[0]?.value ?? "", /^\[REDACTED: \d+ characters\]$/);

    const fileDrop = assertOk(await bc.browser.drop({
      target: "#file",
      files: [fixtureFile],
    }), "file drop");
    assert.equal(fileDrop.files?.[0]?.path, fixtureFile);

    assertOk(await bc.browser.highlight({
      target: button.ref,
      persist: true,
      style: "pointer-events:auto;position:fixed;background-image:url(https://example.invalid/x.png);border:3px solid red",
    }), "highlight");

    const page = bc.sessionManager.getBrowserManager().getContext()?.pages()[0];
    assert.ok(page, "live page should be available");

    const domState = await page.evaluate(() => ({
      clicked: document.body.dataset.clicked,
      inputValue: (document.getElementById("name") as HTMLInputElement).value,
      dropped: document.getElementById("drop-output")?.textContent,
      highlightedCount: document.querySelectorAll("[data-browser-control-highlight]").length,
      highlightPointerEvents: (document.querySelector("[data-browser-control-highlight]") as HTMLElement | null)?.style.pointerEvents,
      highlightPosition: (document.querySelector("[data-browser-control-highlight]") as HTMLElement | null)?.style.position,
      highlightBackgroundImage: (document.querySelector("[data-browser-control-highlight]") as HTMLElement | null)?.style.backgroundImage,
    }));
    assert.deepEqual(domState, {
      clicked: "yes",
      inputValue: "Ada",
      dropped: "token:abc=123",
      highlightedCount: 1,
      highlightPointerEvents: "none",
      highlightPosition: "absolute",
      highlightBackgroundImage: "",
    });

    const screenshot = assertOk(await bc.browser.screenshot({
      annotate: true,
      refs: [button.ref],
    }), "annotated screenshot");
    assert.ok(fs.existsSync(screenshot.path), "screenshot file should exist");
    assert.ok(screenshot.sizeBytes > 512, "screenshot should be non-empty");
    const annotationLeftBehind = await page.evaluate(() => Boolean(document.querySelector("[data-browser-control-annotation-root]")));
    assert.equal(annotationLeftBehind, false, "annotation overlay should be temporary");

    const downloads = assertOk(await bc.browser.downloads.list(), "downloads list");
    assert.ok(downloads.some((download) => download.path === downloadedPath), "downloads list should include session artifact");

    const stopped = assertOk(await bc.browser.screencast.stop(), "screencast stop");
    assert.ok(stopped.receiptId, "stop should return receipt id");
    assert.ok(stopped.timelinePath && fs.existsSync(stopped.timelinePath), "timeline file should exist");

    const timeline = JSON.parse(fs.readFileSync(stopped.timelinePath!, "utf8")) as TimelineEvent[];
    for (const action of ["fill", "click", "drop", "highlight", "screenshot"]) {
      assert.ok(timeline.some((event) => event.action === action && event.success === true), `timeline missing ${action}`);
    }

    const receipt = bc.debug.receipt(stopped.receiptId!);
    assert.equal(receipt?.receiptId, stopped.receiptId);
    assert.ok(receipt?.artifacts.some((artifact) => artifact.kind === "timeline"), "receipt should reference timeline artifact");
  } finally {
    await bc.browser.close().catch(() => undefined);
    bc.close();
    resetGlobalScreencastRecorder();
    if (previousHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = previousHome;
    }
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch {
      // Windows may release Chrome profile files slightly late.
    }
  }
});
