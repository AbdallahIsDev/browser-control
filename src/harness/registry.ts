/**
 * Harness Registry — Helper registration, lookup, validation, activation, and rollback.
 *
 * Helpers are stored under Browser Control data home (not repo source).
 * Invalid helpers cannot be activated.
 */

import fs from "node:fs";
import path from "node:path";
import { getDataHome } from "../shared/paths";
import type { HarnessHelperManifest, HelperValidationResult, HelperValidationCheck } from "./types";

const HARNESS_DIR_NAME = "harness";
const REGISTRY_FILE = "registry.json";

// ── Unsafe patterns ───────────────────────────────────────────────────

const UNSAFE_PATH_PATTERNS = [
  /\.\./,                     // path traversal
  /node_modules/,             // dependency injection
  /(^|[\\/])src[\\/]/,        // core source
  /(^|[\\/])dist[\\/]/,       // built output
];

const UNSAFE_CONTENT_PATTERNS = [
  /eval\s*\(/,
  /Function\s*\(/,
  /\bchild_process\b/,
  /node:child_process/,
  /require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/,
  /import\s+.*from\s+['"](?:node:)?fs(?:\/promises)?['"]/,
  /import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/,
  /process\.exit/,
  /import\s+.*from\s+['"](?:node:)?child_process['"]/,
  /import\s*\(\s*['"](?:node:)?child_process['"]\s*\)/,
];

const SAFE_HELPER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_HELPER_FILE_BYTES = 256 * 1024;

// ── Path helpers ──────────────────────────────────────────────────────

export function getHarnessDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), HARNESS_DIR_NAME);
}

export function getHarnessRegistryPath(dataHome?: string): string {
  return path.join(getHarnessDir(dataHome), REGISTRY_FILE);
}

export function getHelperDir(helperId: string, dataHome?: string): string {
  if (!isSafeHelperId(helperId)) {
    throw new Error(`Unsafe helper id: ${helperId}`);
  }
  return path.join(getHarnessDir(dataHome), "helpers", helperId);
}

export function isSafeHelperId(helperId: string): boolean {
  return SAFE_HELPER_ID.test(helperId);
}

function ensureHarnessDir(dataHome?: string): void {
  const dir = getHarnessDir(dataHome);
  fs.mkdirSync(path.join(dir, "helpers"), { recursive: true });
}

function isSafeHelperRelativePath(file: string): boolean {
  if (!file || typeof file !== "string") return false;
  if (path.isAbsolute(file)) return false;
  const normalized = path.normalize(file);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  return !UNSAFE_PATH_PATTERNS.some(pattern => pattern.test(normalized));
}

function resolveHelperFile(helperDir: string, file: string): string | null {
  if (!isSafeHelperRelativePath(file)) return null;
  const resolved = path.resolve(helperDir, file);
  const resolvedRoot = path.resolve(helperDir);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

// ── Registry ──────────────────────────────────────────────────────────

export class HarnessRegistry {
  private readonly dataHome?: string;

  constructor(options?: { dataHome?: string }) {
    this.dataHome = options?.dataHome;
  }

  /**
   * Load all registered helpers.
   */
  list(): HarnessHelperManifest[] {
    const registryPath = getHarnessRegistryPath(this.dataHome);
    if (!fs.existsSync(registryPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Get a specific helper by ID.
   */
  get(helperId: string): HarnessHelperManifest | null {
    if (!isSafeHelperId(helperId)) return null;
    return this.list().find(h => h.id === helperId) ?? null;
  }

  /**
   * Find helpers matching domain, task tags, or failure types.
   */
  find(query: { domain?: string; taskTag?: string; failureType?: string }): HarnessHelperManifest[] {
    return this.list().filter(h => {
      if (query.domain && h.domains && !h.domains.includes(query.domain)) return false;
      if (query.taskTag && !h.taskTags.includes(query.taskTag)) return false;
      if (query.failureType && !h.failureTypes.includes(query.failureType)) return false;
      return true;
    });
  }

  /**
   * Register a new helper. Does NOT activate it.
   */
  register(manifest: HarnessHelperManifest): void {
    if (!isSafeHelperId(manifest.id)) {
      throw new Error(`Unsafe helper id: ${manifest.id}`);
    }
    ensureHarnessDir(this.dataHome);
    manifest.activated = false;
    manifest.createdAt = manifest.createdAt || new Date().toISOString();
    manifest.updatedAt = new Date().toISOString();

    const helpers = this.list();
    const existing = helpers.findIndex(h => h.id === manifest.id);
    if (existing >= 0) {
      // Preserve previous version
      const prev = helpers[existing];
      manifest.previousVersions = [...(prev.previousVersions ?? []), prev.version];
      helpers[existing] = manifest;
    } else {
      helpers.push(manifest);
    }

    this.saveRegistry(helpers);
  }

  /**
   * Validate a helper. Returns structured validation result.
   */
  validate(helperId: string): HelperValidationResult {
    const checks: HelperValidationCheck[] = [];
    if (!isSafeHelperId(helperId)) {
      checks.push({ name: "schema", status: "failed", message: `Unsafe helper id: ${helperId}` });
      return { helperId, status: "failed", checks };
    }

    const manifest = this.get(helperId);

    // 1. Schema check
    if (!manifest) {
      checks.push({ name: "schema", status: "failed", message: `Helper not found: ${helperId}` });
      return { helperId, status: "failed", checks };
    }

    checks.push(
      manifest.id && manifest.version && manifest.purpose
        ? { name: "schema", status: "passed" }
        : { name: "schema", status: "failed", message: "Missing required manifest fields" },
    );

    // 2. Path safety check
    const unsafePaths = manifest.files.filter(f => !isSafeHelperRelativePath(f));
    checks.push(
      unsafePaths.length === 0
        ? { name: "path_safety", status: "passed" }
        : { name: "path_safety", status: "failed", message: `Unsafe paths: ${unsafePaths.join(", ")}` },
    );

    // 3. Static safety check (scan file contents if available)
    const helperDir = getHelperDir(helperId, this.dataHome);
    let contentSafe = true;
    for (const file of manifest.files) {
      const filePath = resolveHelperFile(helperDir, file);
      if (!filePath) {
        contentSafe = false;
        checks.push({ name: "static_safety", status: "failed", message: `Unsafe helper file path: ${file}` });
        continue;
      }
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_HELPER_FILE_BYTES) {
          contentSafe = false;
          checks.push({ name: "static_safety", status: "failed", message: `Helper file too large: ${file}` });
          continue;
        }
        const content = fs.readFileSync(filePath, "utf8");
        for (const pattern of UNSAFE_CONTENT_PATTERNS) {
          if (pattern.test(content)) {
            contentSafe = false;
            checks.push({ name: "static_safety", status: "failed", message: `Unsafe pattern in ${file}: ${pattern.source}` });
            break;
          }
        }
      }
    }
    if (contentSafe) {
      checks.push({ name: "static_safety", status: "passed" });
    }

    // 4. Dependency check — helpers must not reference core source
    const coreRefs = manifest.files.some(f => {
      const normalized = path.normalize(f);
      return normalized.startsWith(`src${path.sep}`) || normalized.startsWith(`dist${path.sep}`);
    });
    checks.push(
      !coreRefs
        ? { name: "dependency_safety", status: "passed" }
        : { name: "dependency_safety", status: "failed", message: "Helper files reference core source paths" },
    );

    const allPassed = checks.every(c => c.status === "passed");
    return { helperId, status: allPassed ? "passed" : "failed", checks };
  }

  /**
   * Activate a helper only if validation passes.
   */
  activate(helperId: string): HelperValidationResult {
    const result = this.validate(helperId);
    if (result.status !== "passed") return result;

    const helpers = this.list();
    const idx = helpers.findIndex(h => h.id === helperId);
    if (idx >= 0) {
      helpers[idx].activated = true;
      helpers[idx].lastVerifiedAt = new Date().toISOString();
      helpers[idx].updatedAt = new Date().toISOString();
      this.saveRegistry(helpers);
    }

    return result;
  }

  /**
   * Rollback a helper to a previous version.
   */
  rollback(helperId: string, targetVersion: string): { success: boolean; error?: string } {
    if (!isSafeHelperId(helperId)) return { success: false, error: `Unsafe helper id: ${helperId}` };
    const manifest = this.get(helperId);
    if (!manifest) return { success: false, error: `Helper not found: ${helperId}` };
    if (!manifest.previousVersions?.includes(targetVersion)) {
      return { success: false, error: `Version ${targetVersion} not found in history` };
    }

    const helpers = this.list();
    const idx = helpers.findIndex(h => h.id === helperId);
    if (idx >= 0) {
      helpers[idx].version = targetVersion;
      helpers[idx].activated = false; // Deactivate after rollback, requires re-validation
      helpers[idx].updatedAt = new Date().toISOString();
      this.saveRegistry(helpers);
    }

    return { success: true };
  }

  private saveRegistry(helpers: HarnessHelperManifest[]): void {
    ensureHarnessDir(this.dataHome);
    fs.writeFileSync(getHarnessRegistryPath(this.dataHome), JSON.stringify(helpers, null, 2), "utf8");
  }
}
