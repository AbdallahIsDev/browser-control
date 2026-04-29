/**
 * Debug Bundle Assembly/Storage — Best-effort evidence collection on failure.
 *
 * Assembles a DebugBundle when a step fails. Collects:
 *   - browser evidence (url, title, snapshot, screenshot, console, network)
 *   - terminal evidence (last output, exit code, prompt state)
 *   - filesystem evidence (path, operation)
 *   - exception info
 *   - recovery guidance
 *   - retry summary
 *
 * Bundle generation is best-effort and bounded. If any evidence collection
 * fails, the bundle is marked partial and continues.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  DebugBundle,
  DebugBundleBrowserEvidence,
  DebugBundleTerminalEvidence,
  DebugBundleFsEvidence,
  DebugBundleException,
  RetrySummary,
  RecoveryGuidance,
  ConsoleEntry,
  NetworkEntry,
} from "./types";
import { OBSERVABILITY_KEYS } from "./types";
import { generateRecoveryGuidance } from "./recovery";
import { redactObject } from "./redaction";
import type { MemoryStore } from "../runtime/memory_store";
import type { A11yElement } from "../a11y_snapshot";

// ── Bundle Builder Options ─────────────────────────────────────────────

export type { DebugBundle };

export interface BundleBuilderOptions {
  taskId: string;
  sessionId: string;
  executionPath: DebugBundle["executionPath"];
  error: unknown;
  /** Optional: browser page for evidence collection */
  page?: {
    url(): string;
    title(): Promise<string>;
    screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
    evaluate<T>(fn: () => T): Promise<T>;
  } | null;
  /** Optional: terminal session info */
  terminalSession?: {
    sessionId: string;
    lastOutput: string;
    exitCode?: number;
    promptState: string;
    shell?: string;
    cwd?: string;
  } | null;
  /** Optional: filesystem operation info */
  fsOperation?: {
    path: string;
    operation: string;
    errorCode?: string;
  } | null;
  /** Optional: recent actions from telemetry */
  recentActions?: DebugBundle["recentActions"];
  /** Optional: policy decisions from audit log */
  policyDecisions?: DebugBundle["policyDecisions"];
  /** Optional: retry info */
  retrySummary?: Partial<RetrySummary>;
  /** Optional: pre-collected console entries */
  consoleEntries?: ConsoleEntry[];
  /** Optional: pre-collected network entries */
  networkEntries?: NetworkEntry[];
  /** Optional: snapshot data (if already collected) */
  snapshot?: A11yElement[];
  /** Optional: screencast/receipt metadata (Section 26) */
  screencastPath?: string;
  actionTimelinePath?: string;
  annotatedScreenshotPath?: string;
  lastFramePath?: string;
  recordingPolicy?: "keep" | "delete-on-success" | "debug-only";
}

// ── Bundle Builder ─────────────────────────────────────────────────────

export async function buildDebugBundle(options: BundleBuilderOptions): Promise<DebugBundle> {
  const partialReasons: string[] = [];
  const bundleId = generateBundleId();

  // Collect browser evidence
  let browserEvidence: DebugBundleBrowserEvidence | undefined;
  if (options.page) {
    try {
      browserEvidence = await collectBrowserEvidence(options.page, {
        consoleEntries: options.consoleEntries,
        networkEntries: options.networkEntries,
        snapshot: options.snapshot,
        screencastPath: options.screencastPath,
        actionTimelinePath: options.actionTimelinePath,
        annotatedScreenshotPath: options.annotatedScreenshotPath,
        lastFramePath: options.lastFramePath,
        recordingPolicy: options.recordingPolicy,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      partialReasons.push(`Browser evidence collection failed: ${msg}`);
    }
  }

  // Collect terminal evidence
  let terminalEvidence: DebugBundleTerminalEvidence | undefined;
  if (options.terminalSession) {
    try {
      terminalEvidence = {
        sessionId: options.terminalSession.sessionId,
        lastOutput: options.terminalSession.lastOutput.slice(-5000), // Bounded
        exitCode: options.terminalSession.exitCode,
        promptState: options.terminalSession.promptState,
        shell: options.terminalSession.shell,
        cwd: options.terminalSession.cwd,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      partialReasons.push(`Terminal evidence collection failed: ${msg}`);
    }
  }

  // Collect filesystem evidence
  let fsEvidence: DebugBundleFsEvidence | undefined;
  if (options.fsOperation) {
    fsEvidence = {
      path: options.fsOperation.path,
      operation: options.fsOperation.operation,
      errorCode: options.fsOperation.errorCode,
    };
  }

  // Build exception info
  const exception = buildException(options.error);

  // Build retry summary
  const retrySummary: RetrySummary = {
    attempts: options.retrySummary?.attempts ?? 1,
    totalDurationMs: options.retrySummary?.totalDurationMs ?? 0,
    backoffUsed: options.retrySummary?.backoffUsed ?? false,
    lastError: exception.message,
  };

  // Generate recovery guidance
  const recoveryGuidance = generateRecoveryGuidance(options.error);

  const bundle: DebugBundle = {
    bundleId,
    taskId: options.taskId,
    sessionId: options.sessionId,
    executionPath: options.executionPath,
    recentActions: options.recentActions ?? [],
    policyDecisions: redactPolicyDecisions(options.policyDecisions ?? []),
    exception,
    retrySummary,
    recoveryGuidance,
    assembledAt: new Date().toISOString(),
    partial: partialReasons.length > 0,
    ...(partialReasons.length > 0 ? { partialReasons } : {}),
    ...(browserEvidence ? { browser: browserEvidence } : {}),
    ...(terminalEvidence ? { terminal: terminalEvidence } : {}),
    ...(fsEvidence ? { filesystem: fsEvidence } : {}),
  };

  return redactObject(bundle) as DebugBundle;
}

// ── Evidence Collectors ────────────────────────────────────────────────

async function collectBrowserEvidence(
  page: NonNullable<BundleBuilderOptions["page"]>,
  extras: {
    consoleEntries?: ConsoleEntry[];
    networkEntries?: NetworkEntry[];
    snapshot?: A11yElement[];
    screencastPath?: string;
    actionTimelinePath?: string;
    annotatedScreenshotPath?: string;
    lastFramePath?: string;
    recordingPolicy?: "keep" | "delete-on-success" | "debug-only";
  },
): Promise<DebugBundleBrowserEvidence> {
  const url = page.url();
  const title = await page.title().catch(() => "unknown");

  // Screenshot (best-effort, bounded timeout)
  let screenshot: string | undefined;
  try {
    const screenshotBuffer = await Promise.race([
      page.screenshot({ fullPage: false }),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("Screenshot timeout")), 3000),
      ),
    ]);
    screenshot = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;
  } catch {
    // Skip screenshot on timeout/failure
  }

  // Snapshot (best-effort)
  let snapshot: A11yElement[] | undefined;
  if (extras.snapshot) {
    snapshot = extras.snapshot;
  } else {
    try {
      snapshot = await page.evaluate(() => {
        // Lightweight DOM snapshot
        const elements: A11yElement[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node: Node | null;
        let idx = 0;
        while ((node = walker.nextNode()) && idx < 50) {
          const el = node as Element;
          const role = el.getAttribute("role") || el.tagName.toLowerCase();
          const name = el.getAttribute("aria-label") || el.getAttribute("title") || "";
          elements.push({
            ref: `e${idx}`,
            role,
            name,
            text: el.textContent?.slice(0, 100) || "",
          });
          idx++;
        }
        return elements;
      });
    } catch {
      // Skip snapshot on failure
    }
  }

  return {
    url,
    title,
    screenshot,
    snapshot,
    consoleEntries: extras.consoleEntries ?? [],
    networkEntries: extras.networkEntries ?? [],
    // Section 26: Screencast and debug receipt artifacts
    screencastPath: extras.screencastPath,
    actionTimelinePath: extras.actionTimelinePath,
    annotatedScreenshotPath: extras.annotatedScreenshotPath,
    lastFramePath: extras.lastFramePath,
    recordingPolicy: extras.recordingPolicy,
  };
}

function buildException(error: unknown): DebugBundleException {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      code: (error as Error & { code?: string }).code,
    };
  }
  return {
    message: String(error),
  };
}

function redactPolicyDecisions(
  decisions: DebugBundle["policyDecisions"],
): DebugBundle["policyDecisions"] {
  return decisions.map((d) => ({
    ...d,
    reason: d.reason ? String(redactObject(d.reason)) : undefined,
  }));
}

function generateBundleId(): string {
  return `bundle-${crypto.randomUUID()}`;
}

// ── Storage ────────────────────────────────────────────────────────────

export function getBundleDir(): string {
  const { getDataHome } = require("../shared/paths");
  return path.join(getDataHome(), "debug-bundles");
}

export function ensureBundleDir(): string {
  const dir = getBundleDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SAFE_BUNDLE_ID = /^bundle-[A-Za-z0-9_-]{1,128}$/;

export function isValidDebugBundleId(bundleId: string): boolean {
  return SAFE_BUNDLE_ID.test(bundleId);
}

function resolveBundlePath(bundleId: string, ensureDir = false): string | null {
  if (!isValidDebugBundleId(bundleId)) {
    return null;
  }

  const dir = ensureDir ? ensureBundleDir() : getBundleDir();
  const resolvedDir = path.resolve(dir);
  const resolvedFile = path.resolve(resolvedDir, `${bundleId}.json`);
  const relative = path.relative(resolvedDir, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolvedFile;
}

/**
 * Save a debug bundle to disk and optionally to MemoryStore.
 */
export function saveDebugBundle(
  bundle: DebugBundle,
  store?: MemoryStore,
): { filePath: string; storeKey?: string } {
  const filePath = resolveBundlePath(bundle.bundleId, true);
  if (!filePath) {
    throw new Error(`Invalid debug bundle ID: ${bundle.bundleId}`);
  }

  // Redact before saving
  const safeBundle = redactObject(bundle) as DebugBundle;

  fs.writeFileSync(filePath, JSON.stringify(safeBundle, null, 2));

  let storeKey: string | undefined;
  if (store) {
    storeKey = `${OBSERVABILITY_KEYS.bundlePrefix}${bundle.bundleId}`;
    store.set(storeKey, safeBundle, 7 * 24 * 60 * 60 * 1000); // 7 day TTL
  }

  return { filePath, storeKey };
}

/**
 * Load a debug bundle from MemoryStore or disk.
 */
export function loadDebugBundle(
  bundleId: string,
  store?: MemoryStore,
): DebugBundle | null {
  if (!isValidDebugBundleId(bundleId)) {
    return null;
  }

  // Try MemoryStore first
  if (store) {
    const fromStore = store.get<DebugBundle>(`${OBSERVABILITY_KEYS.bundlePrefix}${bundleId}`);
    if (fromStore) return fromStore;
  }

  // Try disk
  const filePath = resolveBundlePath(bundleId);
  if (!filePath) return null;
  if (filePath && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content) as DebugBundle;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * List available debug bundles.
 */
export function listDebugBundles(store?: MemoryStore): Array<{ bundleId: string; taskId: string; assembledAt: string; partial: boolean }> {
  const results: Array<{ bundleId: string; taskId: string; assembledAt: string; partial: boolean }> = [];

  // List from disk
  const dir = getBundleDir();
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const bundleId = path.basename(file, ".json");
      if (!isValidDebugBundleId(bundleId)) {
        continue;
      }
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf8");
        const bundle = JSON.parse(content) as DebugBundle;
        results.push({
          bundleId: bundle.bundleId,
          taskId: bundle.taskId,
          assembledAt: bundle.assembledAt,
          partial: bundle.partial,
        });
      } catch {
        // Skip corrupt files
      }
    }
  }

  // List from MemoryStore
  if (store) {
    const keys = store.keys(OBSERVABILITY_KEYS.bundlePrefix);
    for (const key of keys) {
      const bundle = store.get<DebugBundle>(key);
      if (bundle) {
        // Avoid duplicates
        if (!results.some((r) => r.bundleId === bundle.bundleId)) {
          results.push({
            bundleId: bundle.bundleId,
            taskId: bundle.taskId,
            assembledAt: bundle.assembledAt,
            partial: bundle.partial,
          });
        }
      }
    }
  }

  // Sort by assembledAt desc
  return results.sort((a, b) => new Date(b.assembledAt).getTime() - new Date(a.assembledAt).getTime());
}

/**
 * Delete a debug bundle.
 */
export function deleteDebugBundle(bundleId: string, store?: MemoryStore): boolean {
  if (!isValidDebugBundleId(bundleId)) {
    return false;
  }

  let deleted = false;

  // Delete from disk
  const filePath = resolveBundlePath(bundleId);
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    deleted = true;
  }

  // Delete from MemoryStore
  if (store) {
    store.delete(`${OBSERVABILITY_KEYS.bundlePrefix}${bundleId}`);
    deleted = true;
  }

  return deleted;
}

/**
 * Clean up old debug bundles.
 */
export function pruneDebugBundles(maxAgeMs: number, store?: MemoryStore): number {
  let pruned = 0;
  const cutoff = Date.now() - maxAgeMs;

  // Prune from disk
  const dir = getBundleDir();
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          pruned++;
        }
      } catch {
        // Skip on error
      }
    }
  }

  // Prune from MemoryStore (best-effort, depends on stored timestamp)
  if (store) {
    const keys = store.keys(OBSERVABILITY_KEYS.bundlePrefix);
    for (const key of keys) {
      const bundle = store.get<DebugBundle>(key);
      if (bundle && new Date(bundle.assembledAt).getTime() < cutoff) {
        store.delete(key);
        pruned++;
      }
    }
  }

  return pruned;
}
