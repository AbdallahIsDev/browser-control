import fs from "node:fs";
import path from "node:path";

import { Logger, logger } from "./shared/logger";
import type {
  Skill,
  SkillContext,
  SkillManifest,
  SkillAction,
  ActionParamType,
  ManifestValidationResult,
} from "./skill";
import { isPackagedSkillDir, loadPackagedSkillDir } from "./skill_yaml";

const registryLog = logger.withComponent("skill-registry");

const VALID_PARAM_TYPES: Set<string> = new Set<ActionParamType>([
  "string", "number", "boolean", "object", "array",
]);

export interface SkillRegistryEntry {
  skill: Skill;
  setupComplete: boolean;
  /** Directory path for packaged skills, undefined for flat .ts files. */
  dirPath?: string;
}

// ── Manifest Validation ───────────────────────────────────────────────

export function validateManifest(manifest: SkillManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required string fields
  if (!manifest.name || typeof manifest.name !== "string") {
    errors.push("manifest.name is required and must be a string.");
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    errors.push("manifest.version is required and must be a string.");
  }
  if (!manifest.description || typeof manifest.description !== "string") {
    errors.push("manifest.description is required and must be a string.");
  }

  // requiredEnv must be an array of strings
  if (!Array.isArray(manifest.requiredEnv)) {
    errors.push("manifest.requiredEnv must be an array of strings.");
  } else {
    for (const env of manifest.requiredEnv) {
      if (typeof env !== "string") {
        errors.push(`manifest.requiredEnv contains a non-string entry: ${String(env)}`);
      }
    }
  }

  // allowedDomains must be an array of strings
  if (!Array.isArray(manifest.allowedDomains)) {
    errors.push("manifest.allowedDomains must be an array of strings.");
  } else {
    for (const domain of manifest.allowedDomains) {
      if (typeof domain !== "string") {
        errors.push(`manifest.allowedDomains contains a non-string entry: ${String(domain)}`);
      }
    }
  }

  // Validate actions if present
  if (manifest.actions) {
    if (!Array.isArray(manifest.actions)) {
      errors.push("manifest.actions must be an array.");
    } else {
      const seenNames = new Set<string>();
      for (let i = 0; i < manifest.actions.length; i++) {
        const action = manifest.actions[i];
        if (!action.name || typeof action.name !== "string") {
          errors.push(`actions[${i}].name is required and must be a string.`);
        } else if (seenNames.has(action.name)) {
          errors.push(`actions[${i}].name "${action.name}" is duplicated.`);
        } else {
          seenNames.add(action.name);
        }

        if (typeof action.description !== "string" || action.description === "") {
          warnings.push(`actions[${i}].description is recommended for action "${action.name || i}".`);
        }

        // Validate params
        if (action.params) {
          if (!Array.isArray(action.params)) {
            errors.push(`actions[${i}].params must be an array.`);
          } else {
            for (let j = 0; j < action.params.length; j++) {
              const param = action.params[j];
              if (!param.name || typeof param.name !== "string") {
                errors.push(`actions[${i}].params[${j}].name is required.`);
              }
              if (!VALID_PARAM_TYPES.has(param.type)) {
                errors.push(
                  `actions[${i}].params[${j}].type "${param.type}" is not a valid param type. Valid: ${[...VALID_PARAM_TYPES].join(", ")}`,
                );
              }
            }
          }
        }
      }
    }
  }

  // Config schema validation
  if (manifest.configSchema) {
    if (typeof manifest.configSchema !== "string") {
      errors.push("manifest.configSchema must be a string path.");
    }
    // JSON validity of the config schema file is checked during packaged skill loading
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Skill Registry ────────────────────────────────────────────────────

export class SkillRegistry {
  private readonly entries = new Map<string, SkillRegistryEntry>();
  private readonly loadedFiles = new Set<string>();

  register(skill: Skill): void {
    const name = skill.manifest.name;
    if (this.entries.has(name)) {
      throw new Error(`Skill "${name}" is already registered.`);
    }
    this.entries.set(name, { skill, setupComplete: false });
  }

  /** Register with validation — skip invalid skills with a warning instead of crashing. */
  registerValidated(skill: Skill): boolean {
    const validation = validateManifest(skill.manifest);
    if (!validation.valid) {
      registryLog.warn(
        `Skipping skill "${skill.manifest.name || "(unknown)"}" — manifest validation failed`,
        { errors: validation.errors },
      );
      return false;
    }
    if (validation.warnings.length > 0) {
      registryLog.warn(
        `Skill "${skill.manifest.name}" has manifest warnings`,
        { warnings: validation.warnings },
      );
    }
    this.register(skill);
    return true;
  }

  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  get(name: string): Skill | undefined {
    return this.entries.get(name)?.skill;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): SkillManifest[] {
    return Array.from(this.entries.values()).map((entry) => entry.skill.manifest);
  }

  listNames(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Get actions for a skill, if declared in the manifest. */
  getActions(name: string): SkillAction[] {
    const entry = this.entries.get(name);
    return entry?.skill.manifest.actions ?? [];
  }

  /** Get the directory path for a packaged skill, or undefined for flat .ts skills. */
  getDirPath(name: string): string | undefined {
    return this.entries.get(name)?.dirPath;
  }

  async setup(name: string, context: SkillContext): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`Skill "${name}" is not registered.`);
    }
    if (entry.setupComplete) {
      return;
    }
    await entry.skill.setup(context);
    entry.setupComplete = true;
  }

  async execute(name: string, action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`Skill "${name}" is not registered.`);
    }
    return entry.skill.execute(action, params);
  }

  async teardown(name: string, context: SkillContext): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) {
      return;
    }
    await entry.skill.teardown(context);
    entry.setupComplete = false;
  }

  async teardownAll(context: SkillContext): Promise<void> {
    for (const [name] of this.entries) {
      await this.teardown(name, context);
    }
  }

  async healthCheck(name: string, context: SkillContext): Promise<{ healthy: boolean; details?: string }> {
    const entry = this.entries.get(name);
    if (!entry) {
      return { healthy: false, details: `Skill "${name}" is not registered.` };
    }
    return entry.skill.healthCheck(context);
  }

  async healthCheckAll(context: SkillContext): Promise<Record<string, { healthy: boolean; details?: string }>> {
    const results: Record<string, { healthy: boolean; details?: string }> = {};
    for (const [name] of this.entries) {
      results[name] = await this.healthCheck(name, context);
    }
    return results;
  }

  validateEnv(name: string, env: NodeJS.ProcessEnv = process.env): { valid: boolean; missing: string[] } {
    const entry = this.entries.get(name);
    if (!entry) {
      return { valid: false, missing: [`Skill "${name}" is not registered.`] };
    }

    const missing = entry.skill.manifest.requiredEnv.filter((key) => !env[key]);
    return { valid: missing.length === 0, missing };
  }

  isDomainAllowed(name: string, hostname: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) {
      return false;
    }

    const allowedDomains = entry.skill.manifest.allowedDomains;
    if (allowedDomains.length === 0) {
      return true;
    }

    return allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  }

  /** Validate a skill manifest by name (already registered) or from a raw manifest object. */
  validateSkillManifest(nameOrManifest: string | SkillManifest): ManifestValidationResult {
    const manifest = typeof nameOrManifest === "string"
      ? this.entries.get(nameOrManifest)?.skill.manifest
      : nameOrManifest;

    if (!manifest) {
      return { valid: false, errors: [`Skill "${nameOrManifest}" is not registered.`], warnings: [] };
    }

    return validateManifest(manifest);
  }

  size(): number {
    return this.entries.size;
  }

  /** Load a single skill module from a .ts file path. The module must export a default or named Skill object. */
  async loadFromFile(filePath: string): Promise<Skill[]> {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Skill file not found: ${absolutePath}`);
    }
    if (this.loadedFiles.has(absolutePath)) {
      return [];
    }

    // Use require() instead of import() so ts-node path aliases resolve.
    // Individual skill load failures are non-fatal: a broken skill
    // with unresolvable development-only path aliases
    // should not prevent the daemon from starting. Terminal and FS
    // features work independently of any specific skill.
    let mod: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(absolutePath) as Record<string, unknown>;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      registryLog.warn(
        `Skipping skill file "${filePath}" — load failed`,
        { error: message },
      );
      return [];
    }

    // Mark as loaded only after successful require() so broken files
    // are not permanently cached (they could be fixed and re-loaded).
    this.loadedFiles.add(absolutePath);

    const skills: Skill[] = [];

    // Try default export first
    if (isSkill(mod.default)) {
      skills.push(mod.default);
    }

    // Also collect named exports that look like skills (xxxSkill)
    for (const [key, value] of Object.entries(mod)) {
      if (key === "default") continue;
      if (isSkill(value)) {
        skills.push(value);
      }
    }

    for (const skill of skills) {
      if (!this.entries.has(skill.manifest.name)) {
        this.registerValidated(skill);
      }
    }

    return skills;
  }

  /** Load a packaged skill from a directory containing skill.yaml. */
  async loadPackagedSkill(dirPath: string): Promise<Skill | null> {
    const absoluteDir = path.resolve(dirPath);
    if (!isPackagedSkillDir(absoluteDir)) {
      return null;
    }
    if (this.loadedFiles.has(absoluteDir)) {
      return null;
    }

    try {
      const meta = loadPackagedSkillDir(absoluteDir);
      if (!meta) {
        return null;
      }

      // Validate the manifest before loading
      const validation = validateManifest(meta.manifest);
      if (!validation.valid) {
        registryLog.warn(
          `Skipping packaged skill from "${dirPath}" — manifest validation failed`,
          { errors: validation.errors },
        );
        return null;
      }

      // Validate config schema if present
      if (meta.manifest.configSchema && meta.hasConfigSchema) {
        try {
          const schemaPath = path.join(meta.dirPath, meta.manifest.configSchema);
          JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        } catch {
          registryLog.warn(
            `Packaged skill "${meta.manifest.name}" has invalid config.schema.json`,
          );
        }
      }

      // Load the entry file
      if (!fs.existsSync(meta.entryPath)) {
        registryLog.warn(
          `Packaged skill "${meta.manifest.name}" entry file not found: ${meta.entryPath}`,
        );
        return null;
      }

      this.loadedFiles.add(absoluteDir);
      const skills = await this.loadFromFile(meta.entryPath);
      // Tag the registry entry with the dirPath
      const entry = this.entries.get(meta.manifest.name);
      if (entry) {
        entry.dirPath = absoluteDir;
      }

      return skills[0] ?? null;
    } catch (error: unknown) {
      registryLog.warn(
        `Failed to load packaged skill from "${dirPath}"`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /** Auto-discover and load all .ts skill files from a directory. Also loads packaged skill subdirectories. */
  async loadFromDirectory(dirPath: string): Promise<Skill[]> {
    const absoluteDir = path.resolve(dirPath);
    if (!fs.existsSync(absoluteDir)) {
      return [];
    }

    const allSkills: Skill[] = [];

    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check if it's a packaged skill directory
        const subDir = path.join(absoluteDir, entry.name);
        if (isPackagedSkillDir(subDir)) {
          const skill = await this.loadPackagedSkill(subDir);
          if (skill) allSkills.push(skill);
        }
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        const skills = await this.loadFromFile(path.join(absoluteDir, entry.name));
        allSkills.push(...skills);
      }
    }

    return allSkills;
  }

  /** Install a packaged skill by copying its directory into the skills data dir. */
  installSkill(sourceDir: string, targetDir: string): { success: boolean; name?: string; error?: string } {
    if (!isPackagedSkillDir(sourceDir)) {
      return { success: false, error: `Source directory is not a packaged skill: ${sourceDir}` };
    }

    const meta = loadPackagedSkillDir(sourceDir);
    if (!meta) {
      return { success: false, error: `Failed to load skill.yaml from: ${sourceDir}` };
    }

    const validation = validateManifest(meta.manifest);
    if (!validation.valid) {
      return { success: false, error: `Manifest validation failed: ${validation.errors.join(", ")}` };
    }

    // Copy directory
    const destDir = path.join(targetDir, meta.manifest.name);
    try {
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }
      fs.mkdirSync(destDir, { recursive: true });
      copyDirSync(sourceDir, destDir);
    } catch (error: unknown) {
      return { success: false, error: `Failed to copy skill directory: ${error instanceof Error ? error.message : String(error)}` };
    }

    return { success: true, name: meta.manifest.name };
  }

  /** Remove a packaged skill directory from the skills data dir. */
  removeSkill(name: string, skillsDataDir: string): { success: boolean; error?: string } {
    const entry = this.entries.get(name);
    const dirPath = entry?.dirPath ?? path.join(skillsDataDir, name);

    if (!fs.existsSync(dirPath)) {
      return { success: false, error: `Skill directory not found: ${dirPath}` };
    }

    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      this.unregister(name);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: `Failed to remove skill directory: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Return the set of file paths that have been loaded. */
  getLoadedFiles(): string[] {
    return Array.from(this.loadedFiles);
  }

  clear(): void {
    this.entries.clear();
    this.loadedFiles.clear();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!obj.manifest || typeof obj.manifest !== "object") return false;
  const manifest = obj.manifest as Record<string, unknown>;
  return typeof manifest.name === "string"
    && typeof manifest.version === "string"
    && typeof obj.setup === "function"
    && typeof obj.execute === "function"
    && typeof obj.teardown === "function"
    && typeof obj.healthCheck === "function";
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
