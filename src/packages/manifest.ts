import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateWorkflowGraph } from "../workflows/types";
import { validateUiSpec } from "../operator/generated_ui";
import type { AutomationPackageManifest } from "./types";

export interface ManifestValidationResult {
  valid: boolean;
  manifest: AutomationPackageManifest | null;
  errors: string[];
}

const MAX_MANIFEST_SIZE_BYTES = 1024 * 512; // 512 KB
const MAX_WORKFLOW_SIZE_BYTES = 1024 * 1024; // 1 MB
const MAX_EVAL_SIZE_BYTES = 1024 * 256; // 256 KB
const MAX_UI_SPEC_SIZE_BYTES = 1024 * 256; // 256 KB
const MAX_ARRAY_SIZE = 100;
const VALID_MANIFEST_NAMES = ["automation-package.json", "package.browser-control.json"];

export const PACKAGE_NAME_REGEX = /^[a-z0-9-]+$/;

const PackageNameSchema = z.string().regex(PACKAGE_NAME_REGEX);

const PermissionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("browser"),
    domains: z.array(z.string()).max(100),
  }).strict(),
  z.object({
    kind: z.literal("filesystem"),
    paths: z.array(z.string()).max(100),
    access: z.enum(["read", "write", "read-write"]),
  }).strict(),
  z.object({
    kind: z.literal("terminal"),
    commands: z.array(z.string()).max(100),
  }).strict(),
  z.object({
    kind: z.literal("network"),
    domains: z.array(z.string()).max(100),
  }).strict(),
  z.object({
    kind: z.literal("helper"),
    helperIds: z.array(z.string()).max(100),
  }).strict(),
]);

const ManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  name: PackageNameSchema,
  version: z.string(),
  description: z.string(),
  browserControlVersion: z.string(),
  permissions: z.array(PermissionSchema).max(100),
  configSchema: z.unknown().optional(),
  uiSpec: z.string().optional(),
  workflows: z.array(z.string()).max(100).optional(),
  helpers: z.array(z.string()).max(100).optional(),
  evals: z.array(z.string()).max(100).optional(),
  entrypoints: z.record(z.string(), z.string()).optional(),
  provenance: z.object({
    source: z.string().optional(),
    license: z.string().optional(),
    homepage: z.string().optional(),
  }).optional(),
}).strict();

const EvalDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  workflow: z.string(),
  expectedStatus: z.enum(["completed", "failed"]),
  timeoutMs: z.number().int().positive().max(600000).optional(),
  artifacts: z.array(z.string()).optional(),
}).strict();

/**
 * Harden relative path resolution.
 */
export function safeResolveRelativePath(packageRoot: string, relPath: string): string {
  if (typeof relPath !== "string") {
    throw new Error("Path must be a string");
  }
  
  // Reject absolute paths and both slash styles as root indicators
  if (path.isAbsolute(relPath) || relPath.startsWith("/") || relPath.startsWith("\\")) {
    throw new Error(`Absolute paths are not allowed: ${relPath}`);
  }

  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (parts.some(p => p === "..")) {
    throw new Error(`Path traversal detected: ${relPath}`);
  }

  const reserved = new Set([".git", "node_modules", "src", "dist"]);
  if (parts.some(p => reserved.has(p))) {
    throw new Error(`Reserved directory in path: ${relPath}`);
  }

  const normalized = path.normalize(relPath);
  const resolved = path.resolve(packageRoot, normalized);
  const rootResolved = path.resolve(packageRoot);
  const rootRelative = path.relative(rootResolved, resolved);
  if (rootRelative === "" || rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) {
     throw new Error(`Resolved path is outside package root: ${relPath}`);
  }

  try {
    const realPath = fs.realpathSync(resolved);
    const realRoot = fs.realpathSync(rootResolved);
    const realRelative = path.relative(realRoot, realPath);
    if (realRelative === "" || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
       throw new Error(`Symlink escape detected: ${relPath}`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw err;
    }
  }

  return resolved;
}

export function validatePackageManifest(
  manifestPath: string,
  packageRoot: string
): ManifestValidationResult {
  const errors: string[] = [];
  
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, manifest: null, errors: ["Manifest file not found"] };
  }

  const stat = fs.statSync(manifestPath);
  if (stat.size > MAX_MANIFEST_SIZE_BYTES) {
    return { valid: false, manifest: null, errors: [`Manifest exceeds maximum size of ${MAX_MANIFEST_SIZE_BYTES} bytes`] };
  }

  const basename = path.basename(manifestPath);
  if (!VALID_MANIFEST_NAMES.includes(basename)) {
    return { valid: false, manifest: null, errors: [`Invalid manifest name. Must be one of: ${VALID_MANIFEST_NAMES.join(", ")}`] };
  }

  let content: string;
  let rawManifest: any;
  try {
    content = fs.readFileSync(manifestPath, "utf8");
    rawManifest = JSON.parse(content);
  } catch (err) {
    return { valid: false, manifest: null, errors: ["Failed to parse manifest JSON"] };
  }

  const result = ManifestSchema.safeParse(rawManifest);
  if (!result.success) {
    return {
      valid: false,
      manifest: null,
      errors: result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`),
    };
  }

  const manifest = result.data as AutomationPackageManifest;

  // Validate uiSpec
  if (manifest.uiSpec !== undefined) {
    try {
      const uiSpecPath = safeResolveRelativePath(packageRoot, manifest.uiSpec);
      if (!fs.existsSync(uiSpecPath)) {
        errors.push(`uiSpec file not found: ${manifest.uiSpec}`);
      } else if (fs.statSync(uiSpecPath).size > MAX_UI_SPEC_SIZE_BYTES) {
        errors.push(`uiSpec exceeds maximum size: ${manifest.uiSpec}`);
      } else {
        const specContent = fs.readFileSync(uiSpecPath, "utf8");
        const uiSpecJson = JSON.parse(specContent);
        validateUiSpec(uiSpecJson);
      }
    } catch (err) {
      errors.push(`uiSpec validation failed: ${(err as Error).message}`);
    }
  }

  // Validate workflows
  if (manifest.workflows !== undefined) {
    for (const wf of manifest.workflows) {
      try {
        const wfPath = safeResolveRelativePath(packageRoot, wf);
        if (!fs.existsSync(wfPath)) {
          errors.push(`Workflow file not found: ${wf}`);
        } else if (fs.statSync(wfPath).size > MAX_WORKFLOW_SIZE_BYTES) {
          errors.push(`Workflow exceeds maximum size: ${wf}`);
        } else {
          const wfJson = JSON.parse(fs.readFileSync(wfPath, "utf8"));
          const wfVal = validateWorkflowGraph(wfJson);
          if (!wfVal.valid) {
            errors.push(`Invalid workflow ${wf}: ${wfVal.errors.join("; ")}`);
          }
        }
      } catch (err) {
        errors.push(`Workflow validation failed for ${wf}: ${(err as Error).message}`);
      }
    }
  }

  // Validate helpers
  if (manifest.helpers !== undefined) {
    for (const hp of manifest.helpers) {
      try {
        const hpPath = safeResolveRelativePath(packageRoot, hp);
        if (!fs.existsSync(hpPath)) {
          errors.push(`Helper file not found: ${hp}`);
        }
      } catch (err) {
        errors.push(`Helper validation failed for ${hp}: ${(err as Error).message}`);
      }
    }
  }

  // Validate evals
  if (manifest.evals !== undefined) {
    for (const ev of manifest.evals) {
      try {
        const evPath = safeResolveRelativePath(packageRoot, ev);
        if (!fs.existsSync(evPath)) {
          errors.push(`Eval file not found: ${ev}`);
        } else if (fs.statSync(evPath).size > MAX_EVAL_SIZE_BYTES) {
          errors.push(`Eval exceeds maximum size: ${ev}`);
        } else {
          const evJson = JSON.parse(fs.readFileSync(evPath, "utf8"));
          const evArray = Array.isArray(evJson) ? evJson : [evJson];
          for (const entry of evArray) {
             const evResult = EvalDefinitionSchema.safeParse(entry);
             if (!evResult.success) {
               errors.push(`Eval definition error in ${ev}: ${evResult.error.errors.map(e => e.message).join("; ")}`);
             }
          }
        }
      } catch (err) {
        errors.push(`Eval validation failed for ${ev}: ${(err as Error).message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    manifest: errors.length === 0 ? manifest : null,
    errors,
  };
}
