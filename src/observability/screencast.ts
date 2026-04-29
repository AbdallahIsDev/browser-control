/**
 * Screencast Recorder — Browser screencast lifecycle and action timeline (Section 26).
 *
 * This module manages browser screencast recording with:
 *   - start/stop/status lifecycle
 *   - action timeline recording
 *   - debug receipt generation
 *   - retention-based cleanup
 *   - adapter for native Playwright screencast or fallback modes
 *
 * Recording is opt-in and best-effort. Failures do not break browser automation.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ScreencastSession,
  ScreencastOptions,
  ScreencastStatus,
  ActionReceiptEvent,
  DebugReceipt,
} from "./types";
import type { MemoryStore } from "../runtime/memory_store";
import { OBSERVABILITY_KEYS } from "./types";
import {
  getSessionScreencastDir,
  ensureSessionScreencastDir,
  getSessionReceiptDir,
  ensureSessionReceiptDir,
  isSafeArtifactPath,
  getDataHome,
} from "../shared/paths";
import { logger } from "../shared/logger";

const log = logger.withComponent("screencast");

// ── Screencast Recorder ──────────────────────────────────────────────────

export class ScreencastRecorder {
  private activeSession: ScreencastSession | null = null;
  private timeline: ActionReceiptEvent[] = [];
  private store: MemoryStore | null = null;
  private frameCaptureInterval: NodeJS.Timeout | null = null;
  private nativeRecorder: any = null; // Playwright screencast context if available
  private page: any = null; // Store page reference for annotations

  constructor(options?: { store?: MemoryStore }) {
    this.store = options?.store ?? null;
  }

  /**
   * Start a screencast recording for the current browser session.
   */
  async start(options: {
    browserSessionId: string;
    pageId: string;
    options?: ScreencastOptions;
    page?: {
      url(): string;
      title(): Promise<string>;
      screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
      evaluate<T>(fn: () => T): Promise<T>;
    };
  }): Promise<ScreencastSession> {
    if (this.status()) {
      throw new Error("Screencast already in progress. Stop current recording first.");
    }

    const { browserSessionId, pageId, options: screencastOptions = {}, page } = options;
    const sessionId = browserSessionId;

    // Validate and resolve output path
    let outputPath: string;
    if (screencastOptions.path) {
      if (!isSafeArtifactPath(screencastOptions.path)) {
        throw new Error(`Unsafe screencast path: ${screencastOptions.path}`);
      }
      outputPath = screencastOptions.path;
    } else {
      const dir = ensureSessionScreencastDir(sessionId);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      outputPath = path.join(dir, `screencast-${timestamp}.webm`);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    // Determine recording mode
    let mode: "native" | "frames" | "metadata-only" = "metadata-only";
    
    // Try native Playwright screencast if page is available and supports it
    if (page && typeof (page as any).screencast === "function") {
      try {
        this.nativeRecorder = (page as any).screencast({
          path: outputPath,
          ...screencastOptions.showActions ? {
            showActionLabels: true,
            showMouse: true,
          } : {},
        });
        mode = "native";
        log.info(`Started native Playwright screencast: ${outputPath}`);
      } catch (error) {
        log.warn(`Native screencast not available, falling back to frames: ${error}`);
        mode = "frames";
      }
    } else if (page) {
      mode = "frames";
      log.info("Using frame capture mode for screencast");
    }

    // Start frame capture if in frames mode
    if (mode === "frames" && page) {
      this.startFrameCapture(page, outputPath);
    }

    // Inject action annotation overlay if showActions is enabled
    if (screencastOptions.showActions && page) {
      this.page = page;
      await this.injectActionAnnotationRoot();
    }

    // Create screencast session
    const session: ScreencastSession = {
      id: crypto.randomUUID(),
      browserSessionId,
      pageId,
      path: outputPath,
      startedAt: new Date().toISOString(),
      status: "recording",
      actionAnnotations: screencastOptions.showActions ?? false,
      retention: screencastOptions.retention ?? "keep",
      mode,
    };

    this.activeSession = session;
    this.timeline = [];

    // Store session in memory store if available
    if (this.store) {
      this.store.set(
        `${OBSERVABILITY_KEYS.screencastPrefix}${session.id}`,
        session,
        24 * 60 * 60 * 1000 // 24 hour TTL
      );
    }

    return session;
  }

  /**
   * Stop the current screencast recording and save receipt.
   * Restores from MemoryStore if process-local activeSession is empty.
   */
  async stop(success: boolean = true): Promise<{
    session: ScreencastSession;
    receipt?: DebugReceipt;
    timelinePath?: string;
  }> {
    const session = this.status();
    if (!session) {
      throw new Error("No active screencast to stop");
    }

    session.stoppedAt = new Date().toISOString();
    session.status = success ? "stopped" : "failed";

    // Stop native recorder if active
    if (this.nativeRecorder) {
      try {
        await this.nativeRecorder.stop();
        this.nativeRecorder = null;
      } catch (error) {
        log.warn(`Error stopping native recorder: ${error}`);
        session.status = "failed";
      }
    }

    // Stop frame capture if active
    if (this.frameCaptureInterval) {
      clearInterval(this.frameCaptureInterval);
      this.frameCaptureInterval = null;
    }

    // Remove action annotations if present
    if (session.actionAnnotations) {
      await this.removeActionAnnotations().catch(() => {});
    }

    // Save timeline
    let timelinePath: string | undefined;
    if (this.timeline.length > 0) {
      timelinePath = await this.saveTimeline(session);
    }

    // Generate debug receipt
    let receipt: DebugReceipt | undefined;
    try {
      receipt = await this.generateReceipt(session, success, timelinePath);
    } catch (error) {
      log.warn(`Failed to generate receipt: ${error}`);
    }

    // Apply retention policy for all cases (including debug-only on success)
    await this.applyRetention(session, success);

    // Update session in memory store
    if (this.store) {
      this.store.set(`${OBSERVABILITY_KEYS.screencastPrefix}${session.id}`, session);
      // Clean up timeline from memory store
      const timelineKey = `${OBSERVABILITY_KEYS.screencastPrefix}${session.id}:timeline`;
      this.store.delete(timelineKey);
    }

    this.activeSession = null;

    return { session, receipt, timelinePath };
  }

  /**
   * Get the current screencast status.
   * Restores from MemoryStore if process-local activeSession is empty.
   */
  status(): ScreencastSession | null {
    if (this.activeSession) {
      return this.activeSession;
    }

    // Try to restore from memory store
    if (this.store) {
      const sessionKeys = this.store.keys(OBSERVABILITY_KEYS.screencastPrefix);
      for (const key of sessionKeys) {
        const session = this.store.get<ScreencastSession>(key);
        if (session && session.status === "recording") {
          this.activeSession = session;
          // Restore timeline from memory store if available
          const timelineKey = `${key}:timeline`;
          const storedTimeline = this.store.get<ActionReceiptEvent[]>(timelineKey);
          this.timeline = storedTimeline ?? [];
          return session;
        }
      }
    }

    return null;
  }

  /**
   * Append an action event to the timeline.
   * Persists timeline incrementally to MemoryStore if available.
   */
  appendEvent(event: ActionReceiptEvent): void {
    const session = this.status();
    if (!session) {
      return; // Silently skip if no active recording
    }
    this.timeline.push(event);

    // Persist timeline incrementally to memory store
    if (this.store) {
      const timelineKey = `${OBSERVABILITY_KEYS.screencastPrefix}${session.id}:timeline`;
      const existingTimeline = this.store.get<ActionReceiptEvent[]>(timelineKey) ?? [];
      existingTimeline.push(event);
      this.store.set(timelineKey, existingTimeline, 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Mark the recording as failed (e.g., on browser disconnect).
   */
  async markFailed(reason: string): Promise<void> {
    if (!this.activeSession) {
      return;
    }
    log.warn(`Marking screencast as failed: ${reason}`);
    await this.stop(false);
  }

  /**
   * Update the current action annotation label.
   */
  async updateActionAnnotation(action: string, target?: string): Promise<void> {
    if (!this.activeSession || !this.activeSession.actionAnnotations) return;

    const page = this.page;
    if (!page) return;

    try {
      await page.evaluate((actionText: string, targetText?: string) => {
        const root = document.querySelector('[data-browser-control-screencast-root]');
        if (!root) return;

        // Remove old action label
        const oldLabel = root.querySelector('[data-screencast-action-label]');
        if (oldLabel) oldLabel.remove();

        // Add new action label
        const label = document.createElement('div');
        label.setAttribute('data-screencast-action-label', 'true');
        label.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 8px 12px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          z-index: 999999;
          pointer-events: none;
        `;
        label.textContent = targetText ? `${actionText}: ${targetText}` : actionText;
        root.appendChild(label);
      }, action, target);
    } catch (error) {
      log.warn(`Failed to update action annotation: ${error}`);
    }
  }

  /**
   * Remove all action annotation overlays.
   */
  async removeActionAnnotations(): Promise<void> {
    if (!this.activeSession || !this.page) return;

    const page = this.page;
    try {
      await page.evaluate(() => {
        const root = document.querySelector('[data-browser-control-screencast-root]');
        if (root) root.remove();
      });
    } catch (error) {
      log.warn(`Failed to remove action annotations: ${error}`);
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private async injectActionAnnotationRoot(): Promise<void> {
    if (!this.page) return;

    try {
      await this.page.evaluate(() => {
        // Remove existing root if any
        const existing = document.querySelector('[data-browser-control-screencast-root]');
        if (existing) existing.remove();

        // Create overlay root
        const root = document.createElement('div');
        root.setAttribute('data-browser-control-screencast-root', 'true');
        root.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 999998;
        `;
        document.body.appendChild(root);
      });
    } catch (error) {
      log.warn(`Failed to inject action annotation root: ${error}`);
    }
  }

  private startFrameCapture(page: any, outputPath: string): void {
    const frameDir = path.dirname(outputPath);
    const framePrefix = path.basename(outputPath, path.extname(outputPath));
    let frameIndex = 0;

    // Capture a frame every 500ms
    this.frameCaptureInterval = setInterval(async () => {
      try {
        const framePath = path.join(frameDir, `${framePrefix}-frame-${frameIndex}.png`);
        const buffer = await page.screenshot({ fullPage: false });
        fs.writeFileSync(framePath, buffer);
        frameIndex++;
      } catch (error) {
        log.warn(`Frame capture failed: ${error}`);
      }
    }, 500);
    this.frameCaptureInterval.unref?.();
  }

  private async saveTimeline(session: ScreencastSession): Promise<string> {
    const sessionId = session.browserSessionId;
    const dir = ensureSessionReceiptDir(sessionId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const timelinePath = path.join(dir, `timeline-${timestamp}.json`);

    fs.writeFileSync(timelinePath, JSON.stringify(this.timeline, null, 2));
    return timelinePath;
  }

  private async generateReceipt(
    session: ScreencastSession,
    success: boolean,
    timelinePath?: string,
  ): Promise<DebugReceipt> {
    const sessionId = session.browserSessionId;
    const dir = ensureSessionReceiptDir(sessionId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const receiptPath = path.join(dir, `receipt-${timestamp}.json`);

    // Collect artifacts
    const artifacts: Array<{ kind: string; path: string; sizeBytes?: number }> = [];
    
    if (fs.existsSync(session.path)) {
      const stats = fs.statSync(session.path);
      artifacts.push({ kind: "screencast", path: session.path, sizeBytes: stats.size });
    }
    
    if (timelinePath && fs.existsSync(timelinePath)) {
      const stats = fs.statSync(timelinePath);
      artifacts.push({ kind: "timeline", path: timelinePath, sizeBytes: stats.size });
    }

    // Check for last frame in frames mode
    if (session.mode === "frames") {
      const frameDir = path.dirname(session.path);
      const framePrefix = path.basename(session.path, path.extname(session.path));
      const frameFiles = fs.readdirSync(frameDir)
        .filter(f => f.startsWith(`${framePrefix}-frame-`) && f.endsWith(".png"))
        .sort();
      if (frameFiles.length > 0) {
        const lastFrame = path.join(frameDir, frameFiles[frameFiles.length - 1]);
        const stats = fs.statSync(lastFrame);
        artifacts.push({ kind: "lastFrame", path: lastFrame, sizeBytes: stats.size });
      }
    }

    const receipt: DebugReceipt = {
      taskId: session.id,
      receiptId: crypto.randomUUID(),
      status: success ? "success" : "failure",
      startedAt: session.startedAt,
      completedAt: session.stoppedAt || new Date().toISOString(),
      artifacts,
      timelinePath,
      screencastPath: fs.existsSync(session.path) ? session.path : undefined,
      recordingPolicy: session.retention,
    };

    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

    // Store receipt in memory store
    if (this.store) {
      this.store.set(
        `${OBSERVABILITY_KEYS.receiptPrefix}${receipt.receiptId}`,
        receipt,
        7 * 24 * 60 * 60 * 1000 // 7 day TTL
      );
    }

    return receipt;
  }

  private async applyRetention(session: ScreencastSession, success: boolean): Promise<void> {
    const { retention, path: screencastPath } = session;

    // Keep: do nothing
    if (retention === "keep") {
      return;
    }

    // Delete-on-success: delete video/frames if successful, keep timeline/receipt
    if (retention === "delete-on-success" && success) {
      try {
        if (fs.existsSync(screencastPath)) {
          fs.unlinkSync(screencastPath);
          log.info(`Deleted screencast per delete-on-success policy: ${screencastPath}`);
        }
        // Delete frames if in frames mode
        if (session.mode === "frames") {
          const frameDir = path.dirname(screencastPath);
          const framePrefix = path.basename(screencastPath, path.extname(screencastPath));
          const frameFiles = fs.readdirSync(frameDir)
            .filter(f => f.startsWith(`${framePrefix}-frame-`) && f.endsWith(".png"));
          for (const frameFile of frameFiles) {
            fs.unlinkSync(path.join(frameDir, frameFile));
          }
        }
      } catch (error) {
        log.warn(`Failed to apply delete-on-success retention: ${error}`);
      }
    }

    // Debug-only: delete all artifacts immediately (timeline/receipt kept by bundle logic)
    if (retention === "debug-only") {
      try {
        if (fs.existsSync(screencastPath)) {
          fs.unlinkSync(screencastPath);
          log.info(`Deleted screencast per debug-only policy: ${screencastPath}`);
        }
        // Delete frames if in frames mode
        if (session.mode === "frames") {
          const frameDir = path.dirname(screencastPath);
          const framePrefix = path.basename(screencastPath, path.extname(screencastPath));
          const frameFiles = fs.readdirSync(frameDir)
            .filter(f => f.startsWith(`${framePrefix}-frame-`) && f.endsWith(".png"));
          for (const frameFile of frameFiles) {
            fs.unlinkSync(path.join(frameDir, frameFile));
          }
        }
      } catch (error) {
        log.warn(`Failed to apply debug-only retention: ${error}`);
      }
    }
  }

  /**
   * Load a screencast session from memory store.
   */
  loadSession(sessionId: string): ScreencastSession | null {
    if (!this.store) return null;
    return this.store.get<ScreencastSession>(`${OBSERVABILITY_KEYS.screencastPrefix}${sessionId}`);
  }

  /**
   * Load a debug receipt from memory store.
   */
  loadReceipt(receiptId: string): DebugReceipt | null {
    if (!this.store) return null;
    return this.store.get<DebugReceipt>(`${OBSERVABILITY_KEYS.receiptPrefix}${receiptId}`);
  }

  /**
   * Clean up old screencast artifacts.
   */
  static pruneOldArtifacts(maxAgeMs: number): number {
    const dataHome = getDataHome();
    const screencastDir = path.join(dataHome, "observability", "screencasts");
    const receiptDir = path.join(dataHome, "observability", "receipts");
    let pruned = 0;
    const cutoff = Date.now() - maxAgeMs;

    // Prune screencast files
    if (fs.existsSync(screencastDir)) {
      const pruneDir = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            pruneDir(filePath);
          } else if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            pruned++;
          }
        }
      };
      pruneDir(screencastDir);
    }

    // Prune old receipt files
    if (fs.existsSync(receiptDir)) {
      const pruneDir = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            pruneDir(filePath);
          } else if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            pruned++;
          }
        }
      };
      pruneDir(receiptDir);
    }

    return pruned;
  }
}

// ── Global Recorder Instance (with MemoryStore) ───────────────────────────

let globalRecorder: ScreencastRecorder | null = null;
let globalStore: MemoryStore | undefined = undefined;

export function getGlobalScreencastRecorder(store?: MemoryStore): ScreencastRecorder {
  if (!globalRecorder) {
    globalStore = store;
    globalRecorder = new ScreencastRecorder({ store: globalStore });
  } else if (store && !globalStore) {
    // Update store if provided and we don't have one yet
    globalStore = store;
    globalRecorder = new ScreencastRecorder({ store: globalStore });
  }
  return globalRecorder;
}

export function resetGlobalScreencastRecorder(): void {
  if (globalRecorder) {
    // Stop any active recording
    globalRecorder.stop(false).catch(() => {});
    globalRecorder = null;
  }
  globalStore = undefined;
}
