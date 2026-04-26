/**
 * Policy Engine - Core Evaluation Logic and Risk Classification
 *
 * This module implements the core policy engine that evaluates RoutedStep objects
 * against the active policy profile and determines whether to allow, audit, require
 * confirmation, or deny the action.
 */

import type {
  PolicyEngine,
  PolicyProfile,
  RoutedStep,
  PolicyEvaluationResult,
  ExecutionContext,
  ConfirmationHandler,
  PolicyAuditEntry,
  PolicyDecision,
  RiskLevel,
  CommandPolicy,
  FilesystemPolicy,
  BrowserPolicy,
  LowLevelPolicy,
} from "./types";
import path from "node:path";
import { getBuiltInProfile, getRiskDecisionMatrix } from "./profiles";
import { Logger } from "../shared/logger";

// ─── Policy Evaluation Context ───────────────────────────────────────────

export interface PolicyEngineOptions {
  profileName?: string;
  customProfile?: PolicyProfile;
  auditEnabled?: boolean;
  auditHandler?: (entry: PolicyAuditEntry) => void;
  logger?: Logger;
}

// ─── Policy Engine Implementation ───────────────────────────────────────

export class DefaultPolicyEngine implements PolicyEngine {
  private profile: PolicyProfile;
  private profileName: string;
  private confirmationHandler: ConfirmationHandler | null;
  private auditEnabled: boolean;
  private auditHandler?: (entry: PolicyAuditEntry) => void;
  private logger: Logger;

  constructor(options: PolicyEngineOptions = {}) {
    this.logger = options.logger ?? new Logger({ component: "policy-engine" });
    this.auditEnabled = options.auditEnabled ?? false;
    this.auditHandler = options.auditHandler;
    this.confirmationHandler = null;

    if (options.customProfile) {
      this.profile = options.customProfile;
      this.profileName = options.customProfile.name;
    } else if (options.profileName) {
      const builtIn = getBuiltInProfile(options.profileName);
      if (!builtIn) {
        this.logger.warn(`Profile "${options.profileName}" not found, degrading to "safe" for security`);
        this.profile = getBuiltInProfile("safe")!;
        this.profileName = "safe";
      } else {
        this.profile = builtIn;
        this.profileName = options.profileName;
      }
    } else {
      this.profile = getBuiltInProfile("balanced")!;
      this.profileName = "balanced";
    }

    this.logger.info(`Policy engine initialized with profile: ${this.profileName}`);
  }

  /**
   * Get the active profile name.
   */
  getActiveProfile(): string {
    return this.profileName;
  }

  /**
   * Set a new profile by name.
   */
  setProfile(profileName: string): void {
    const profile = getBuiltInProfile(profileName);
    if (!profile) {
      throw new Error(`Profile "${profileName}" not found`);
    }
    this.profile = profile;
    this.profileName = profileName;
    this.logger.info(`Policy profile changed to: ${profileName}`);
  }

  /**
   * Set a custom profile.
   */
  setCustomProfile(profile: PolicyProfile): void {
    this.profile = profile;
    this.profileName = profile.name;
    this.logger.info(`Custom policy profile set: ${profile.name}`);
  }

  /**
   * Set the confirmation handler for interactive decisions.
   */
  setConfirmationHandler(handler: ConfirmationHandler | null): void {
    this.confirmationHandler = handler;
  }

  /**
   * Enable or disable audit logging.
   */
  setAuditEnabled(enabled: boolean): void {
    this.auditEnabled = enabled;
  }

  /**
   * Set the audit handler.
   */
  setAuditHandler(handler: (entry: PolicyAuditEntry) => void): void {
    this.auditHandler = handler;
  }

  /**
   * Evaluate a RoutedStep against the active policy profile.
   */
  evaluate(step: RoutedStep, context: ExecutionContext = {}): PolicyEvaluationResult {
    const matrix = getRiskDecisionMatrix(this.profileName);
    if (!matrix) {
      this.logger.error(`No risk decision matrix found for profile: ${this.profileName}`);
      return {
        decision: "deny",
        reason: "Policy configuration error: no risk decision matrix",
        profile: this.profileName,
        risk: step.risk,
        auditRequired: false,
      };
    }

    // First, check category-specific rules
    const categoryResult = this.evaluateCategoryRules(step, context);
    if (categoryResult.decision !== "allow") {
      this.recordAudit(step, categoryResult, context);
      return categoryResult;
    }

    // Then, apply risk-based decision matrix
    const baseDecision = matrix[step.risk];
    const auditRequired = baseDecision === "allow_with_audit";

    const result: PolicyEvaluationResult = {
      decision: baseDecision,
      reason: this.getReasonForDecision(baseDecision, step.risk),
      profile: this.profileName,
      risk: step.risk,
      auditRequired,
    };

    this.recordAudit(step, result, context);
    return result;
  }

  /**
   * Evaluate category-specific policy rules.
   */
  private evaluateCategoryRules(
    step: RoutedStep,
    context: ExecutionContext,
  ): PolicyEvaluationResult {
    switch (step.path) {
      case "command":
        return this.evaluateCommandPolicy(step, context);
      case "a11y":
        return this.evaluateBrowserPolicy(step, context);
      case "low_level":
        return this.evaluateLowLevelPolicy(step, context);
      default:
        return {
          decision: "deny",
          reason: `Unknown execution path: ${step.path}`,
          profile: this.profileName,
          risk: step.risk,
          auditRequired: false,
        };
    }
  }

  /**
   * Evaluate command policy rules.
   */
  private evaluateCommandPolicy(
    step: RoutedStep,
    context: ExecutionContext,
  ): PolicyEvaluationResult {
    if (this.isFilesystemAction(step)) {
      return this.evaluateFilesystemPolicy(step, context);
    }

    const policy = this.profile.commandPolicy;

    // Check denied commands
    if (policy.deniedCommands && policy.deniedCommands.length > 0) {
      const command = typeof step.params.command === "string" ? step.params.command : step.action;
      if (this.matchesCommandPattern(command, policy.deniedCommands)) {
        return {
          decision: "deny",
          reason: `Command matches denied pattern: ${command}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "deniedCommands",
          auditRequired: false,
        };
      }
    }

    // Check allowed commands (if specified, deny everything else)
    if (policy.allowedCommands && policy.allowedCommands.length > 0) {
      const command = typeof step.params.command === "string" ? step.params.command : step.action;
      if (!this.matchesCommandPattern(command, policy.allowedCommands)) {
        return {
          decision: "deny",
          reason: `Command not in allowed list: ${command}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "allowedCommands",
          auditRequired: false,
        };
      }
    }

    // Check working directory restrictions
    if (policy.restrictedWorkingDirectories && policy.restrictedWorkingDirectories.length > 0) {
      const cwd = context.cwd ?? step.params.cwd;
      if (typeof cwd === "string" && this.isInRestrictedPath(cwd, policy.restrictedWorkingDirectories)) {
        return {
          decision: "deny",
          reason: `Working directory is restricted: ${cwd}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "restrictedWorkingDirectories",
          auditRequired: false,
        };
      }
    }

    // Check if confirmation is required
    if (policy.requireConfirmationCommands && policy.requireConfirmationCommands.length > 0) {
      const command = typeof step.params.command === "string" ? step.params.command : step.action;
      if (this.matchesCommandPattern(command, policy.requireConfirmationCommands)) {
        return {
          decision: "require_confirmation",
          reason: `Command requires confirmation: ${command}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "requireConfirmationCommands",
          auditRequired: true,
        };
      }
    }

    return {
      decision: "allow",
      reason: "Command policy allows this action",
      profile: this.profileName,
      risk: step.risk,
      auditRequired: false,
    };
  }

  private evaluateFilesystemPolicy(
    step: RoutedStep,
    context: ExecutionContext,
  ): PolicyEvaluationResult {
    const policy = this.profile.filesystemPolicy;
    const targetPath = this.getFilesystemTargetPath(step);
    const destinationPath = this.getFilesystemDestinationPath(step);
    const isDelete = this.isFilesystemDelete(step);
    const isMove = this.isFilesystemMove(step);
    const isWrite = this.isFilesystemWrite(step);
    const isRead = this.isFilesystemRead(step);
    const isRecursive = step.params.recursive === true;

    if (typeof targetPath === "string") {
      if (isRead && policy.allowedReadRoots && policy.allowedReadRoots.length > 0 && !this.isInAllowedRoots(targetPath, policy.allowedReadRoots)) {
        return {
          decision: "deny",
          reason: `Path is outside allowed read roots: ${targetPath}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "allowedReadRoots",
          auditRequired: false,
        };
      }

      if (isWrite && policy.allowedWriteRoots && policy.allowedWriteRoots.length > 0 && !this.isInAllowedRoots(targetPath, policy.allowedWriteRoots)) {
        return {
          decision: "deny",
          reason: `Path is outside allowed write roots: ${targetPath}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "allowedWriteRoots",
          auditRequired: false,
        };
      }

      if (isDelete && policy.allowedDeleteRoots && policy.allowedDeleteRoots.length > 0 && !this.isInAllowedRoots(targetPath, policy.allowedDeleteRoots)) {
        return {
          decision: "deny",
          reason: `Path is outside allowed delete roots: ${targetPath}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "allowedDeleteRoots",
          auditRequired: false,
        };
      }
    }

    if (isMove && typeof destinationPath === "string" && policy.allowedWriteRoots && policy.allowedWriteRoots.length > 0 && !this.isInAllowedRoots(destinationPath, policy.allowedWriteRoots)) {
      return {
        decision: "deny",
        reason: `Destination path is outside allowed write roots: ${destinationPath}`,
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "allowedWriteRoots",
        auditRequired: false,
      };
    }

    if (isDelete && isRecursive) {
      if (policy.recursiveDeleteDefaultBehavior === "deny") {
        return {
          decision: "deny",
          reason: "Recursive delete is denied by policy",
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "recursiveDeleteDefaultBehavior",
          auditRequired: false,
        };
      }

      return {
        decision: "require_confirmation",
        reason: "Recursive delete requires confirmation",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "recursiveDeleteDefaultBehavior",
        auditRequired: true,
      };
    }

    return {
      decision: "allow",
      reason: "Filesystem policy allows this action",
      profile: this.profileName,
      risk: step.risk,
      auditRequired: false,
    };
  }

  /**
   * Evaluate browser policy rules.
   */
  private evaluateBrowserPolicy(
    step: RoutedStep,
    context: ExecutionContext,
  ): PolicyEvaluationResult {
    const policy = this.profile.browserPolicy;
    const domain = context.targetDomain ?? (step.params.domain as string | undefined);

    // Check blocked domains
    if (policy.blockedDomains && policy.blockedDomains.length > 0 && domain) {
      if (this.matchesDomain(domain, policy.blockedDomains)) {
        return {
          decision: "deny",
          reason: `Domain is blocked: ${domain}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "blockedDomains",
          auditRequired: false,
        };
      }
    }

    // Check allowed domains (if specified, deny everything else)
    if (policy.allowedDomains && policy.allowedDomains.length > 0 && domain) {
      if (!this.matchesDomain(domain, policy.allowedDomains)) {
        return {
          decision: "deny",
          reason: `Domain not in allowed list: ${domain}`,
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "allowedDomains",
          auditRequired: false,
        };
      }
    }

    // Check file upload
    if (!policy.fileUploadAllowed && step.action === "file_upload") {
      return {
        decision: "deny",
        reason: "File uploads are not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "fileUploadAllowed",
        auditRequired: false,
      };
    }

    // Check file download
    if (!policy.fileDownloadAllowed && step.action === "file_download") {
      return {
        decision: "deny",
        reason: "File downloads are not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "fileDownloadAllowed",
        auditRequired: false,
      };
    }

    // Check screenshot
    if (!policy.screenshotAllowed && step.action === "screenshot") {
      return {
        decision: "deny",
        reason: "Screenshots are not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "screenshotAllowed",
        auditRequired: false,
      };
    }

    // Check clipboard
    if (!policy.clipboardAllowed && (step.action === "clipboard_read" || step.action === "clipboard_write")) {
      return {
        decision: "deny",
        reason: "Clipboard access is not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "clipboardAllowed",
        auditRequired: false,
      };
    }

    // Check credential submission
    if (!policy.credentialSubmissionAllowed && this.isCredentialAction(step)) {
      return {
        decision: "deny",
        reason: "Credential submission is not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "credentialSubmissionAllowed",
        auditRequired: false,
      };
    }

    // Check automation only in explicit sessions
    if (policy.automationOnlyInExplicitSessions && context.actor !== "human") {
      const isInternal = context.internalTask ?? false;
      const isExplicit = context.explicitSession ?? false;
      if (!isInternal && !isExplicit) {
        return {
          decision: "deny",
          reason: "Automation only allowed in explicit sessions",
          profile: this.profileName,
          risk: step.risk,
          matchedRule: "automationOnlyInExplicitSessions",
          auditRequired: false,
        };
      }
    }

    return {
      decision: "allow",
      reason: "Browser policy allows this action",
      profile: this.profileName,
      risk: step.risk,
      auditRequired: false,
    };
  }

  /**
   * Evaluate low-level policy rules.
   */
  private evaluateLowLevelPolicy(
    step: RoutedStep,
    context: ExecutionContext,
  ): PolicyEvaluationResult {
    const policy = this.profile.lowLevelPolicy;

    if (!policy.rawCdpAllowed && step.action === "cdp_execute") {
      return {
        decision: "deny",
        reason: "Raw CDP execution is not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "rawCdpAllowed",
        auditRequired: false,
      };
    }

    if (!policy.jsEvalAllowed && step.action === "js_evaluate") {
      return {
        decision: "deny",
        reason: "JavaScript evaluation is not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "jsEvalAllowed",
        auditRequired: false,
      };
    }

    if (!policy.networkInterceptionAllowed && step.action === "network_intercept") {
      return {
        decision: "deny",
        reason: "Network interception is not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "networkInterceptionAllowed",
        auditRequired: false,
      };
    }

    if (!policy.cookieExportImportAllowed && (step.action === "cookie_export" || step.action === "cookie_import")) {
      return {
        decision: "deny",
        reason: "Cookie export/import is not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "cookieExportImportAllowed",
        auditRequired: false,
      };
    }

    if (!policy.coordinateActionsAllowed && step.action === "coordinate_action") {
      return {
        decision: "deny",
        reason: "Coordinate-based actions are not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "coordinateActionsAllowed",
        auditRequired: false,
      };
    }

    if (!policy.performanceTracesAllowed && step.action === "performance_trace") {
      return {
        decision: "deny",
        reason: "Performance traces are not allowed",
        profile: this.profileName,
        risk: step.risk,
        matchedRule: "performanceTracesAllowed",
        auditRequired: false,
      };
    }

    return {
      decision: "allow",
      reason: "Low-level policy allows this action",
      profile: this.profileName,
      risk: step.risk,
      auditRequired: false,
    };
  }

  /**
   * Check if a command matches any pattern in a list.
   */
  private matchesCommandPattern(command: string, patterns: string[]): boolean {
    const cmd = command.toLowerCase().trim();
    return patterns.some(pattern => {
      const pat = pattern.toLowerCase().trim();
      return cmd === pat || cmd.startsWith(pat + " ") || cmd.startsWith(pat + "/");
    });
  }

  /**
   * Check if a domain matches any pattern in a list.
   */
  private matchesDomain(domain: string, patterns: string[]): boolean {
    const normalized = domain.toLowerCase();
    return patterns.some(pattern => {
      const pat = pattern.toLowerCase();
      return normalized === pat || normalized.endsWith(`.${pat}`);
    });
  }

  /**
   * Check if a path is within any restricted directory.
   */
  private isInRestrictedPath(path: string, restrictedDirs: string[]): boolean {
    const normalized = path.replace(/\\/g, "/");
    return restrictedDirs.some(dir => {
      const normalizedDir = dir.replace(/\\/g, "/");
      return normalized.startsWith(normalizedDir) || normalized.startsWith(normalizedDir + "/");
    });
  }

  private isInAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
    const normalizedPath = this.normalizeFilesystemPath(targetPath);
    return allowedRoots.some((root) => {
      const normalizedRoot = this.normalizeFilesystemPath(root);
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
    });
  }

  private normalizeFilesystemPath(inputPath: string): string {
    return path.resolve(inputPath).replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
  }

  private isFilesystemAction(step: RoutedStep): boolean {
    return /^fs_/.test(step.action)
      || ["file_read", "file_write", "file_delete", "file_move", "read_file", "write_file", "delete_file", "move_file"].includes(step.action);
  }

  private isFilesystemRead(step: RoutedStep): boolean {
    return ["fs_read", "fs_list", "fs_stat", "file_read", "read_file"].includes(step.action);
  }

  private isFilesystemWrite(step: RoutedStep): boolean {
    return ["fs_write", "file_write", "write_file", "fs_move", "file_move", "move_file"].includes(step.action);
  }

  private isFilesystemMove(step: RoutedStep): boolean {
    return ["fs_move", "file_move", "move_file"].includes(step.action);
  }

  private isFilesystemDelete(step: RoutedStep): boolean {
    return ["fs_delete", "file_delete", "delete_file"].includes(step.action);
  }

  private getFilesystemTargetPath(step: RoutedStep): string | undefined {
    const directPath = step.params.path;
    if (typeof directPath === "string") {
      return directPath;
    }

    if (typeof step.params.filePath === "string") {
      return step.params.filePath;
    }

    if (typeof step.params.src === "string") {
      return step.params.src;
    }

    return undefined;
  }

  private getFilesystemDestinationPath(step: RoutedStep): string | undefined {
    const dst = step.params.dst ?? step.params.destination ?? step.params.to;
    return typeof dst === "string" ? dst : undefined;
  }

  /**
   * Check if an action involves credentials.
   */
  private isCredentialAction(step: RoutedStep): boolean {
    return step.action === "submit_credentials" ||
      typeof step.params.password !== "undefined" ||
      typeof step.params.secret !== "undefined" ||
      typeof step.params.token !== "undefined" ||
      typeof step.params.apiKey !== "undefined";
  }

  /**
   * Generate a human-readable reason for a decision.
   */
  private getReasonForDecision(decision: PolicyDecision, risk: RiskLevel): string {
    switch (decision) {
      case "allow":
        return `Risk level "${risk}" is within allowed threshold`;
      case "allow_with_audit":
        return `Risk level "${risk}" requires audit logging`;
      case "require_confirmation":
        return `Risk level "${risk}" requires user confirmation`;
      case "deny":
        return `Risk level "${risk}" exceeds allowed threshold`;
    }
  }

  /**
   * Record an audit entry if auditing is enabled.
   */
  private recordAudit(step: RoutedStep, result: PolicyEvaluationResult, context: ExecutionContext): void {
    if (!this.auditEnabled || !this.auditHandler) {
      return;
    }

    const entry: PolicyAuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId ?? step.sessionId ?? "unknown",
      actor: context.actor ?? step.actor ?? "agent",
      step,
      decision: result.decision,
      reason: result.reason,
      profile: result.profile,
      risk: result.risk,
      matchedRule: result.matchedRule,
    };

    this.auditHandler(entry);
  }
}

// ─── Default Singleton Instance ───────────────────────────────────────────

let defaultEngine: DefaultPolicyEngine | null = null;

export function getDefaultPolicyEngine(): DefaultPolicyEngine {
  if (!defaultEngine) {
    defaultEngine = new DefaultPolicyEngine();
  }
  return defaultEngine;
}

export function resetDefaultPolicyEngine(): void {
  if (defaultEngine) {
    defaultEngine = null;
  }
}
