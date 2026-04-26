import type { Page } from "playwright";

import type { CaptchaSolver } from "./captcha_solver";
import type { AIAgent } from "./ai_agent";
import type { MemoryStore } from "./runtime/memory_store";
import type { SkillMemoryStore } from "./skill_memory";
import type { Telemetry } from "./runtime/telemetry";

// ── Action Schema ──────────────────────────────────────────────────

export type ActionParamType = "string" | "number" | "boolean" | "object" | "array";

export interface ActionParam {
  name: string;
  type: ActionParamType;
  required: boolean;
  description?: string;
  default?: unknown;
}

export interface SkillAction {
  name: string;
  description: string;
  params: ActionParam[];
}

// ── Manifest ────────────────────────────────────────────────────────

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  requiredEnv: string[];
  allowedDomains: string[];
  /** Typed action metadata describing the actions this skill supports. */
  actions?: SkillAction[];
  /** If true, the daemon creates a fresh page for this skill before setup. */
  requiresFreshPage?: boolean;
  /** Path to a JSON schema for skill-specific config (relative to skill root). */
  configSchema?: string;
}

// ── Skill Context ───────────────────────────────────────────────────

export interface SkillContext {
  page: Page;
  data: Record<string, unknown>;
  /** Scoped memory store — keys are automatically prefixed with skill:{name}: */
  memoryStore: SkillMemoryStore;
  /** Raw memory store for advanced use (no scoping). */
  rawMemoryStore: MemoryStore;
  telemetry: Telemetry;
  captchaSolver?: CaptchaSolver;
  aiAgent?: AIAgent;
}

// ── Skill Interface ─────────────────────────────────────────────────

export interface Skill {
  readonly manifest: SkillManifest;
  setup(context: SkillContext): Promise<void>;
  execute(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  teardown(context: SkillContext): Promise<void>;
  healthCheck(context: SkillContext): Promise<{ healthy: boolean; details?: string }>;

  // ── Optional Persistence Hooks ────────────────────────────────────

  /** Serialize skill state for persistence across restarts. */
  saveState?(): Record<string, unknown>;
  /** Restore previously persisted skill state. */
  restoreState?(state: Record<string, unknown>): void;

  // ── Optional Lifecycle Hooks ───────────────────────────────────────

  /** Called when the daemon is pausing (graceful shutdown, Chrome disconnect). */
  onPause?(context: SkillContext): Promise<void>;
  /** Called when the daemon resumes after a pause. */
  onResume?(context: SkillContext): Promise<void>;
  /** Called when the skill execution encounters an error. */
  onError?(context: SkillContext, error: Error): Promise<void>;
}

// ── Validation Result ───────────────────────────────────────────────

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
