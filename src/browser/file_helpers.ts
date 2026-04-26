import fs from "node:fs";
import path from "node:path";
import type { Download, Page } from "playwright";

export interface DownloadOptions {
  timeoutMs?: number;
  targetDir?: string;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  sizeBytes: number;
}

export class DownloadManager {
  private readonly defaultDir: string;
  private readonly pendingDownloads = new Map<string, Promise<DownloadResult>>();
  private readonly capturedDirs: string[] = [];

  constructor(defaultDir?: string) {
    this.defaultDir = defaultDir ?? path.join(process.cwd(), "downloads");
  }

  /** Wait for the next download triggered by the page, with optional timeout. */
  async waitForDownload(page: Page, timeoutMs?: number): Promise<DownloadResult> {
    const dir = this.defaultDir;
    fs.mkdirSync(dir, { recursive: true });

    const download = await page.waitForEvent("download", { timeout: timeoutMs ?? 30_000 });
    const fileName = download.suggestedFilename() ?? `download-${Date.now()}`;
    const filePath = path.join(dir, fileName);
    await download.saveAs(filePath);

    const stats = fs.statSync(filePath);
    return { filePath, fileName, sizeBytes: stats.size };
  }

  /** Start capturing all downloads from a page into a specific directory. */
  async captureDownloads(page: Page, dir: string): Promise<void> {
    const absoluteDir = path.resolve(dir);
    fs.mkdirSync(absoluteDir, { recursive: true });
    this.capturedDirs.push(absoluteDir);

    page.on("download", async (download: Download) => {
      const fileName = download.suggestedFilename() ?? `download-${Date.now()}`;
      const filePath = path.join(absoluteDir, fileName);
      const key = `${Date.now()}-${Math.random()}`;
      const promise = (async (): Promise<DownloadResult> => {
        await download.saveAs(filePath);
        const stats = fs.statSync(filePath);
        return { filePath, fileName, sizeBytes: stats.size };
      })();
      this.pendingDownloads.set(key, promise);
      promise.finally(() => {
        this.pendingDownloads.delete(key);
      });
    });
  }

  /** Get all currently pending download promises. */
  getPendingDownloads(): Array<Promise<DownloadResult>> {
    return Array.from(this.pendingDownloads.values());
  }

  /** Download a file from a URL using the browser page context. */
  async downloadFromPage(
    page: Page,
    triggerAction: () => Promise<void>,
    options: DownloadOptions = {},
  ): Promise<DownloadResult> {
    const targetDir = options.targetDir ?? this.defaultDir;
    fs.mkdirSync(targetDir, { recursive: true });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: options.timeoutMs ?? 30000 }),
      triggerAction(),
    ]);

    const fileName = download.suggestedFilename() ?? `download-${Date.now()}`;
    const filePath = path.join(targetDir, fileName);

    await download.saveAs(filePath);

    const stats = fs.statSync(filePath);
    const result: DownloadResult = {
      filePath,
      fileName,
      sizeBytes: stats.size,
    };

    return result;
  }

  /** Download a file by clicking an element that triggers a download. */
  async downloadByClick(
    page: Page,
    selector: string,
    options: DownloadOptions = {},
  ): Promise<DownloadResult> {
    return this.downloadFromPage(
      page,
      async () => {
        await page.click(selector);
      },
      options,
    );
  }

  /** Get the default download directory. */
  getDefaultDir(): string {
    return this.defaultDir;
  }

  /** Get the count of active/pending downloads. */
  getActiveCount(): number {
    return this.pendingDownloads.size;
  }
}

/** Upload a file to a file input element on the page. */
export async function uploadFile(
  page: Page,
  selector: string,
  filePath: string,
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  const fileInput = page.locator(selector);
  await fileInput.setInputFiles(absolutePath);
}

/** Upload multiple files to a file input element on the page. */
export async function uploadFiles(
  page: Page,
  selector: string,
  filePaths: string[],
): Promise<void> {
  const absolutePaths = filePaths.map((filePath) => {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File does not exist: ${absolutePath}`);
    }
    return absolutePath;
  });

  const fileInput = page.locator(selector);
  await fileInput.setInputFiles(absolutePaths);
}

/** Upload a file by simulating a drag-and-drop onto a target element. */
export async function uploadWithDragDrop(
  page: Page,
  targetSelector: string,
  filePath: string,
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }

  // Strategy 1: If the target is or contains a file input, use setInputFiles directly
  const fileInputSelector = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    // Check if target itself is a file input
    if (el instanceof HTMLInputElement && el.type === "file") return sel;
    // Check for a file input inside the drop zone
    const inner = el.querySelector("input[type='file']");
    if (inner instanceof HTMLInputElement) {
      // Give it a temporary ID for targeting
      const id = `__upload_target_${Date.now()}`;
      inner.id = id;
      return `#${id}`;
    }
    return null;
  }, targetSelector);

  if (fileInputSelector) {
    const fileInput = page.locator(fileInputSelector);
    await fileInput.setInputFiles(absolutePath);

    // Dispatch drop events so any JS handlers fire
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const dt = new DataTransfer();
      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, targetSelector);
    return;
  }

  // Strategy 2: Listen for filechooser (triggered when drop zone JS opens a file dialog)
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);

  // Dispatch drag events on the target
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, targetSelector);

  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(absolutePath);
    return;
  }

  // Strategy 3: Inject a temporary file input, set files, and dispatch a synthetic drop
  await page.evaluate(
    ({ selector, fileName }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`Target element not found: ${selector}`);

      // Create a hidden file input
      const input = document.createElement("input");
      input.type = "file";
      input.id = `__inject_${Date.now()}`;
      input.style.display = "none";
      document.body.appendChild(input);

      // Store reference for external set
      (window as unknown as Record<string, unknown>).__uploadInputId = input.id;
    },
    { selector: targetSelector, fileName: path.basename(absolutePath) },
  );

  // Set files on the injected input
  const injectedId = await page.evaluate(() => {
    return (window as unknown as Record<string, unknown>).__uploadInputId as string;
  });

  if (injectedId) {
    const input = page.locator(`#${injectedId}`);
    await input.setInputFiles(absolutePath);

    // Fire a change event on the injected input so handlers see the file
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.dispatchEvent(new Event("change", { bubbles: true }));
        // Clean up
        el.remove();
      }
      delete (window as unknown as Record<string, unknown>).__uploadInputId;
    }, injectedId);
  }
}

/** Validate that a file exists at the given absolute path. */
export function validateFilePath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  if (!path.isAbsolute(absolutePath)) {
    throw new Error(`Path must be absolute: ${filePath}`);
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File does not exist: ${absolutePath}`);
  }
  return absolutePath;
}

/** Get file size in bytes. */
export function getFileSize(filePath: string): number {
  const absolutePath = validateFilePath(filePath);
  const stats = fs.statSync(absolutePath);
  return stats.size;
}

/** List files in a directory, optionally filtered by extension. */
export function listFiles(dirPath: string, extension?: string): string[] {
  const absoluteDir = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const entries = fs.readdirSync(absoluteDir);
  return entries.filter((entry) => {
    const fullPath = path.join(absoluteDir, entry);
    const isFile = fs.statSync(fullPath).isFile();
    if (!isFile) {
      return false;
    }
    if (extension) {
      return entry.endsWith(extension);
    }
    return true;
  });
}
