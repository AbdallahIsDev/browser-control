/**
 * Harness Registry — Helper registration, lookup, validation, activation, and rollback.
 *
 * Helpers are stored under Browser Control data home (not repo source).
 * Invalid helpers cannot be activated.
 */

import fs from "node:fs";
import path from "node:path";
import { redactObject, redactString } from "../observability/redaction";
import { getDataHome } from "../shared/paths";
import { LocalTempSandbox } from "./sandbox";
import type {
  HarnessExecutionResult,
  HarnessGenerateHelperInput,
  HarnessGenerateHelperResult,
  HarnessHelperManifest,
  HelperValidationCheck,
  HelperValidationResult,
  SandboxRunResult,
} from "./types";

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

  async generateHelper(
    input: HarnessGenerateHelperInput,
  ): Promise<HarnessGenerateHelperResult> {
    if (!isSafeHelperId(input.id)) {
      throw new Error(`Unsafe helper id: ${input.id}`);
    }
    if (!input.files.length) {
      throw new Error("Generated helper requires at least one file");
    }

    ensureHarnessDir(this.dataHome);
    const helperDir = getHelperDir(input.id, this.dataHome);
    const previousHelpers = this.list();
    const previousDir = fs.existsSync(helperDir)
      ? fs.mkdtempSync(path.join(getHarnessDir(this.dataHome), "rollback-"))
      : null;
    if (previousDir) {
      fs.cpSync(helperDir, previousDir, { recursive: true });
    }

    const version = input.version ?? `generated-${Date.now()}`;
    const manifest: HarnessHelperManifest = {
      id: input.id,
      site: input.site,
      domains: input.domains,
      taskTags: input.taskTags ?? [],
      failureTypes: input.failureTypes ?? [],
      files: input.files.map((file) => file.path),
      usage: input.usage ?? "Generated Browser Control helper",
      purpose: input.purpose,
      version,
      testCommand: input.testCommand,
      activated: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let validation: HelperValidationResult = {
      helperId: input.id,
      status: "failed",
      checks: [],
    };
    let sandbox: SandboxRunResult | undefined;
    let activated = false;
    let rolledBack = false;

    try {
      fs.mkdirSync(helperDir, { recursive: true });
      for (const file of input.files) {
        const target = resolveHelperFile(helperDir, file.path);
        if (!target) {
          throw new Error(`Unsafe helper file path: ${file.path}`);
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content, "utf8");
      }

      this.register(manifest);
      validation = this.validate(input.id);
      if (validation.status === "passed" && input.testCommand) {
        const sandboxProvider = new LocalTempSandbox();
        try {
          sandbox = await sandboxProvider.run(
            input.testCommand,
            manifest.files,
            helperDir,
          );
        } finally {
          await sandboxProvider.cleanup();
        }
        validation.checks.push(
          sandbox.success
            ? { name: "sandbox", status: "passed", message: sandbox.output }
            : { name: "sandbox", status: "failed", message: sandbox.error },
        );
        if (!sandbox.success) validation.status = "failed";
      }

      if (validation.status !== "passed") {
        this.restoreGeneratedHelper(input.id, previousHelpers, previousDir, helperDir);
        rolledBack = true;
        return {
          success: false,
          helper: manifest,
          helperDir,
          validation,
          sandbox,
          activated: false,
          rolledBack,
          error: "Generated helper failed validation",
        };
      }

      if (input.activate !== false) {
        const activation = this.activate(input.id);
        activated = activation.status === "passed";
        validation = activation;
      }

      return {
        success: true,
        helper: this.get(input.id) ?? manifest,
        helperDir,
        validation,
        sandbox,
        activated,
        rolledBack,
      };
    } catch (error: unknown) {
      this.restoreGeneratedHelper(input.id, previousHelpers, previousDir, helperDir);
      rolledBack = true;
      validation.checks.push({
        name: "generation",
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        helper: manifest,
        helperDir,
        validation,
        sandbox,
        activated: false,
        rolledBack,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (previousDir && fs.existsSync(previousDir)) {
        fs.rmSync(previousDir, { recursive: true, force: true });
      }
    }
  }

  async executeHelper(
    helperId: string,
    input: Record<string, unknown> = {},
  ): Promise<HarnessExecutionResult> {
    const helper = this.get(helperId);
    if (!helper) throw new Error(`Helper not found: ${helperId}`);
    if (!helper.activated) throw new Error(`Helper is not activated: ${helperId}`);
    const validation = this.validate(helperId);
    if (validation.status !== "passed") {
      throw new Error(`Helper validation failed: ${helperId}`);
    }
    let sandbox: SandboxRunResult | undefined;
    if (helper.testCommand) {
      const sandboxProvider = new LocalTempSandbox();
      try {
        sandbox = await sandboxProvider.run(
          helper.testCommand,
          helper.files,
          getHelperDir(helperId, this.dataHome),
          { env: { BC_HELPER_INPUT: JSON.stringify(input) } },
        );
      } finally {
        await sandboxProvider.cleanup();
      }
      sandbox = {
        ...sandbox,
        output: sandbox.output ? redactString(sandbox.output) : sandbox.output,
        error: sandbox.error ? redactString(sandbox.error) : sandbox.error,
      };
    }
    return {
      helperId,
      helper,
      validation,
      sandbox,
      input: redactObject(input) as Record<string, unknown>,
      executedAt: new Date().toISOString(),
    };
  }

  private saveRegistry(helpers: HarnessHelperManifest[]): void {
    ensureHarnessDir(this.dataHome);
    fs.writeFileSync(getHarnessRegistryPath(this.dataHome), JSON.stringify(helpers, null, 2), "utf8");
  }

  private restoreGeneratedHelper(
    helperId: string,
    previousHelpers: HarnessHelperManifest[],
    previousDir: string | null,
    helperDir: string,
  ): void {
    this.saveRegistry(previousHelpers);
    fs.rmSync(helperDir, { recursive: true, force: true });
    if (previousDir && fs.existsSync(previousDir)) {
      fs.cpSync(previousDir, helperDir, { recursive: true });
    }
    if (!previousHelpers.some((helper) => helper.id === helperId)) {
      fs.rmSync(helperDir, { recursive: true, force: true });
    }
  }
}
