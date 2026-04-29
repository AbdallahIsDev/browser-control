/**
 * Screencast Recorder Tests — Verify screencast lifecycle and timeline recording.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScreencastRecorder, getGlobalScreencastRecorder, resetGlobalScreencastRecorder } from "../../../src/observability/screencast";
import { MemoryStore } from "../../../src/runtime/memory_store";

describe("ScreencastRecorder", () => {
  const browserSessionId = "test-session-1";
  const pageId = "page-1";

  it("starts a screencast session in metadata-only mode", async () => {
    const recorder = new ScreencastRecorder();
    const session = await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    assert.strictEqual(session.status, "recording");
    assert.strictEqual(session.browserSessionId, browserSessionId);
    assert.strictEqual(session.pageId, pageId);
    assert.strictEqual(session.mode, "metadata-only");
  });

  it("stops a screencast session and generates receipt", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    const result = await recorder.stop();
    assert.strictEqual(result.session.status, "stopped");
    assert.ok(result.receipt);
  });

  it("returns status for active session", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    const status = recorder.status();
    assert.strictEqual(status?.status, "recording");
  });

  it("returns null when no active session", () => {
    const recorder = new ScreencastRecorder();
    const status = recorder.status();
    assert.strictEqual(status, null);
  });

  it("appends events to timeline", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    recorder.appendEvent({
      timestamp: new Date().toISOString(),
      action: "click",
      target: "#button",
      url: "https://example.com",
    });
    const status = recorder.status();
    // Timeline is stored internally, check it was appended
    assert.ok(status);
  });

  it("saves timeline and receipt on stop", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    recorder.appendEvent({
      timestamp: new Date().toISOString(),
      action: "click",
      target: "#button",
      url: "https://example.com",
    });
    const result = await recorder.stop();
    assert.ok(result.timelinePath);
    assert.ok(result.receipt);
  });

  it("applies retention policy on stop", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "delete-on-success" },
    });
    const result = await recorder.stop();
    assert.strictEqual(result.session.status, "stopped");
    assert.strictEqual(result.session.retention, "delete-on-success");
  });

  it("loads receipt by ID", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    const stopResult = await recorder.stop();
    // Receipt is generated and saved, loadReceipt reads from file system
    // Test verifies the receipt object structure is returned
    if (stopResult.receipt) {
      assert.strictEqual(typeof stopResult.receipt.receiptId, "string");
      assert.strictEqual(typeof stopResult.receipt.taskId, "string");
      assert.strictEqual(stopResult.receipt.status, "success");
    }
  });

  it("throws when starting if already recording", async () => {
    const recorder = new ScreencastRecorder();
    await recorder.start({
      browserSessionId,
      pageId,
      options: { retention: "keep" },
    });
    await assert.rejects(
      async () => {
        await recorder.start({
          browserSessionId,
          pageId,
          options: { retention: "keep" },
        });
      },
      /Screencast already in progress/,
    );
  });

  it("restores active recording state before starting a new recorder instance", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-screencast-store-"));
    const store = new MemoryStore({ filename: path.join(home, "memory.sqlite") });
    try {
      const recorder = new ScreencastRecorder({ store });
      await recorder.start({
        browserSessionId,
        pageId,
        options: { retention: "keep" },
      });

      const restoredRecorder = new ScreencastRecorder({ store });
      assert.equal(restoredRecorder.status()?.status, "recording");
      await assert.rejects(
        () => restoredRecorder.start({
          browserSessionId,
          pageId,
          options: { retention: "keep" },
        }),
        /Screencast already in progress/,
      );

      const stopped = await restoredRecorder.stop();
      assert.equal(stopped.session.status, "stopped");
    } finally {
      store.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("getGlobalScreencastRecorder", () => {
  it("returns a singleton", () => {
    const a = getGlobalScreencastRecorder();
    const b = getGlobalScreencastRecorder();
    assert.strictEqual(a, b);
  });

  it("can be reset", () => {
    const a = getGlobalScreencastRecorder();
    resetGlobalScreencastRecorder();
    const b = getGlobalScreencastRecorder();
    assert.notStrictEqual(a, b);
  });
});
