import assert from "node:assert/strict";
import describe from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DownloadManager, validateFilePath, getFileSize, listFiles, uploadFile, uploadFiles } from "../../src/file_helpers";

/** Create a minimal mock page that supports waitForEvent("download") and click. */
function createMockPageWithDownload(downloadFile: { name: string; content: string; dir: string }) {
  const eventListeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    waitForEvent: async (event: string, options?: { timeout?: number }) => {
      if (event === "download") {
        return new Promise((resolve, reject) => {
          const timeout = options?.timeout ?? 30000;
          const timer = setTimeout(() => reject(new Error("Download timeout")), timeout);

          // Simulate a download arriving after a short delay
          setTimeout(() => {
            clearTimeout(timer);
            const filePath = path.join(downloadFile.dir, downloadFile.name);
            fs.writeFileSync(filePath, downloadFile.content);
            resolve({
              suggestedFilename: () => downloadFile.name,
              saveAs: async (destPath: string) => {
                fs.copyFileSync(filePath, destPath);
              },
            });
          }, 10);
        });
      }
      return Promise.reject(new Error(`Unsupported event: ${event}`));
    },
    click: async (_selector: string) => {
      // Simulate click triggering a download
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (!eventListeners.has(event)) eventListeners.set(event, []);
      eventListeners.get(event)!.push(listener);
    },
    locator: (selector: string) => ({
      setInputFiles: async (files: string | string[]) => {
        // Record what was set
        (globalThis as unknown as Record<string, unknown>).__lastSetInputFiles = { selector, files };
      },
    }),
  } as unknown as Parameters<typeof uploadFile>[0];
}

describe.describe("file_helpers", () => {
  describe.describe("DownloadManager", () => {
    describe.it("creates a download manager with default dir", () => {
      const dm = new DownloadManager();
      assert.ok(dm.getDefaultDir().includes("downloads"));
      assert.equal(dm.getActiveCount(), 0);
    });

    describe.it("creates a download manager with custom dir", () => {
      const dm = new DownloadManager("/tmp/test-downloads");
      assert.equal(dm.getDefaultDir(), "/tmp/test-downloads");
    });

    describe.it("waitForDownload captures a download and saves to disk", async () => {
      const tmpDir = path.join(os.tmpdir(), `fh-wfd-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const dm = new DownloadManager(tmpDir);
        const page = createMockPageWithDownload({
          name: "test-download.txt",
          content: "hello world",
          dir: tmpDir,
        });

        const result = await dm.waitForDownload(page as Parameters<typeof dm.waitForDownload>[0], 5000);
        assert.equal(result.fileName, "test-download.txt");
        assert.ok(result.sizeBytes > 0);
        assert.ok(fs.existsSync(result.filePath));
        assert.equal(fs.readFileSync(result.filePath, "utf8"), "hello world");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe.it("captureDownloads sets up page listener", async () => {
      const tmpDir = path.join(os.tmpdir(), `fh-cd-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const dm = new DownloadManager(tmpDir);
        const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        const mockPage = {
          on: (event: string, listener: (...args: unknown[]) => void) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(listener);
          },
        } as unknown as Parameters<typeof dm.captureDownloads>[0];

        await dm.captureDownloads(mockPage, tmpDir);
        // Verify that a "download" listener was registered
        assert.ok(listeners["download"]);
        assert.equal(listeners["download"].length, 1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe.it("downloadFromPage triggers action and captures download", async () => {
      const tmpDir = path.join(os.tmpdir(), `fh-dfp-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const dm = new DownloadManager(tmpDir);
        const page = createMockPageWithDownload({
          name: "from-action.pdf",
          content: "PDF content",
          dir: tmpDir,
        });

        const result = await dm.downloadFromPage(
          page as Parameters<typeof dm.downloadFromPage>[0],
          async () => { /* trigger action */ },
          { timeoutMs: 5000 },
        );
        assert.equal(result.fileName, "from-action.pdf");
        assert.ok(fs.existsSync(result.filePath));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe.it("downloadByClick triggers click and captures download", async () => {
      const tmpDir = path.join(os.tmpdir(), `fh-dbc-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        const dm = new DownloadManager(tmpDir);
        const page = createMockPageWithDownload({
          name: "clicked.zip",
          content: "zip data",
          dir: tmpDir,
        });

        const result = await dm.downloadByClick(
          page as Parameters<typeof dm.downloadByClick>[0],
          "#download-btn",
          { timeoutMs: 5000 },
        );
        assert.equal(result.fileName, "clicked.zip");
        assert.ok(fs.existsSync(result.filePath));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe.it("getPendingDownloads returns array", () => {
      const dm = new DownloadManager();
      const pending = dm.getPendingDownloads();
      assert.ok(Array.isArray(pending));
      assert.equal(pending.length, 0);
    });
  });

  describe.describe("validateFilePath", () => {
    describe.it("returns absolute path for existing file", () => {
      const tmpFile = path.join(os.tmpdir(), `fh-test-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, "hello");
      try {
        const result = validateFilePath(tmpFile);
        assert.equal(result, path.resolve(tmpFile));
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    });

    describe.it("throws for non-existent file", () => {
      assert.throws(() => validateFilePath("/no/such/file.txt"), /does not exist/);
    });
  });

  describe.describe("getFileSize", () => {
    describe.it("returns file size in bytes", () => {
      const tmpFile = path.join(os.tmpdir(), `fh-size-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, "12345");
      try {
        assert.equal(getFileSize(tmpFile), 5);
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    });
  });

  describe.describe("listFiles", () => {
    describe.it("lists files in a directory", () => {
      const tmpDir = path.join(os.tmpdir(), `fh-list-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tmpDir, "b.json"), "b");
      fs.mkdirSync(path.join(tmpDir, "subdir"));
      try {
        const files = listFiles(tmpDir);
        assert.equal(files.length, 2);
        assert.ok(files.includes("a.txt"));
        assert.ok(files.includes("b.json"));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe.it("filters by extension", () => {
      const tmpDir = path.join(os.tmpdir(), `fh-ext-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tmpDir, "b.json"), "b");
      try {
        const files = listFiles(tmpDir, ".txt");
        assert.equal(files.length, 1);
        assert.equal(files[0], "a.txt");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    describe.it("returns empty array for non-existent directory", () => {
      const files = listFiles("/no/such/directory");
      assert.deepEqual(files, []);
    });
  });

  describe.describe("uploadFile / uploadFiles", () => {
    describe.it("uploadFile calls setInputFiles on the target", async () => {
      const tmpFile = path.join(os.tmpdir(), `fh-up-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, "upload me");

      try {
        delete (globalThis as unknown as Record<string, unknown>).__lastSetInputFiles;
        const page = createMockPageWithDownload({ name: "", content: "", dir: "" });
        await uploadFile(page as Parameters<typeof uploadFile>[0], "#file-input", tmpFile);
        const last = (globalThis as unknown as Record<string, unknown>).__lastSetInputFiles as { selector: string; files: string | string[] };
        assert.ok(last);
        assert.equal(last.selector, "#file-input");
        assert.ok(String(last.files).includes("fh-up-"));
      } finally {
        fs.rmSync(tmpFile, { force: true });
      }
    });

    describe.it("uploadFile throws for non-existent file", async () => {
      const page = {} as unknown as Parameters<typeof uploadFile>[0];
      await assert.rejects(
        () => uploadFile(page, "input[type=file]", "/no/such/file.txt"),
        /does not exist/,
      );
    });

    describe.it("uploadFiles throws for non-existent file", async () => {
      const page = {} as unknown as Parameters<typeof uploadFiles>[0];
      await assert.rejects(
        () => uploadFiles(page, "input[type=file]", ["/no/such/file.txt"]),
        /does not exist/,
      );
    });

    describe.it("uploadFiles calls setInputFiles with multiple files", async () => {
      const tmpDir = path.join(os.tmpdir(), `fh-upm-${Date.now()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const file1 = path.join(tmpDir, "a.txt");
      const file2 = path.join(tmpDir, "b.txt");
      fs.writeFileSync(file1, "a");
      fs.writeFileSync(file2, "b");

      try {
        delete (globalThis as unknown as Record<string, unknown>).__lastSetInputFiles;
        const page = createMockPageWithDownload({ name: "", content: "", dir: "" });
        await uploadFiles(page as Parameters<typeof uploadFiles>[0], "#multi-input", [file1, file2]);
        const last = (globalThis as unknown as Record<string, unknown>).__lastSetInputFiles as { selector: string; files: string[] };
        assert.ok(last);
        assert.equal(last.selector, "#multi-input");
        assert.equal(last.files.length, 2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
