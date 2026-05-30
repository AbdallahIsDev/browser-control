/**
 * Policy Profiles - Built-in Policy Configurations
 *
 * This module provides the built-in policy profiles: safe, balanced, and trusted.
 * Each profile defines the baseline risk-to-decision mapping and category-specific rules.
 */

import type {
  PolicyProfile,
  CommandPolicy,
  FilesystemPolicy,
  BrowserPolicy,
  LowLevelPolicy,
  CredentialPolicy,
  PrivacyPolicy,
  RiskLevel,
  PolicyDecision,
} from "./types";
import fs from "node:fs";
import path from "node:path";
import { getPolicyProfilesDir } from "../shared/paths";

// ── Base Risk to Decision Mapping ────────────────────────────────────────

export interface RiskDecisionMatrix {
  low: PolicyDecision;
  moderate: PolicyDecision;
  high: PolicyDecision;
  critical: PolicyDecision;
}

// ── Safe Profile ────────────────────────────────────────────────────────

const SAFE_RISK_MATRIX: RiskDecisionMatrix = {
  low: "allow",
  moderate: "require_confirmation",
  high: "deny",
  critical: "deny",
};

const SAFE_COMMAND_POLICY: CommandPolicy = {
  allowedCommands: [],
  deniedCommands: ["rm", "rmdir", "del", "format", "fdisk", "dd", "shutdown", "reboot", "halt"],
  requireConfirmationCommands: ["npm", "pip", "apt", "yum", "brew", "choco", "scoop"],
  restrictedWorkingDirectories: [],
  restrictedNetworkClasses: ["public"],
  restrictedProcessClasses: ["system", "kernel"],
  restrictedServiceClasses: ["system-critical"],
};

const SAFE_FILESYSTEM_POLICY: FilesystemPolicy = {
  allowedReadRoots: [],
  allowedWriteRoots: [],
  allowedDeleteRoots: [],
  recursiveDeleteDefaultBehavior: "deny",
  tempDirectoryDefaultBehavior: "allow",
};

const SAFE_BROWSER_POLICY: BrowserPolicy = {
  allowedDomains: [],
  blockedDomains: [],
  fileUploadAllowed: false,
  fileDownloadAllowed: false,
  screenshotAllowed: true,
  clipboardAllowed: false,
  credentialSubmissionAllowed: false,
  automationOnlyInExplicitSessions: true,
  dialogHandling: "must_respond",
  dialogTimeoutMs: 10000,
};

const SAFE_LOW_LEVEL_POLICY: LowLevelPolicy = {
  rawCdpAllowed: false,
  jsEvalAllowed: false,
  networkInterceptionAllowed: false,
  cookieExportImportAllowed: false,
  coordinateActionsAllowed: false,
  performanceTracesAllowed: false,
};

const SAFE_CREDENTIAL_POLICY: CredentialPolicy = {
  secretUseConfirmThreshold: "all",
  secretRevealAllowed: true,
  secretAutoTypeAllowed: false,
  secretAutoPasteAllowed: false,
};

const SAFE_PRIVACY_POLICY: PrivacyPolicy = {
  profile: "strict",
};

export const SAFE_PROFILE: PolicyProfile = {
  name: "safe",
  commandPolicy: SAFE_COMMAND_POLICY,
  filesystemPolicy: SAFE_FILESYSTEM_POLICY,
  browserPolicy: SAFE_BROWSER_POLICY,
  lowLevelPolicy: SAFE_LOW_LEVEL_POLICY,
  credentialPolicy: SAFE_CREDENTIAL_POLICY,
  privacyPolicy: SAFE_PRIVACY_POLICY,
};

// ── Balanced Profile ────────────────────────────────────────────────────

const BALANCED_RISK_MATRIX: RiskDecisionMatrix = {
  low: "allow",
  moderate: "allow_with_audit",
  high: "require_confirmation",
  critical: "require_confirmation",
};

const BALANCED_COMMAND_POLICY: CommandPolicy = {
  allowedCommands: [],
  deniedCommands: ["rm", "rmdir", "format", "fdisk", "dd", "shutdown", "reboot", "halt"],
  requireConfirmationCommands: ["npm", "pip", "apt", "yum", "brew", "choco", "scoop"],
  restrictedWorkingDirectories: [],
  restrictedNetworkClasses: [],
  restrictedProcessClasses: ["system", "kernel"],
  restrictedServiceClasses: ["system-critical"],
};

const BALANCED_FILESYSTEM_POLICY: FilesystemPolicy = {
  allowedReadRoots: [],
  allowedWriteRoots: [],
  allowedDeleteRoots: [],
  recursiveDeleteDefaultBehavior: "require_confirmation",
  tempDirectoryDefaultBehavior: "allow",
};

const BALANCED_BROWSER_POLICY: BrowserPolicy = {
  allowedDomains: [],
  blockedDomains: [],
  fileUploadAllowed: true,
  fileDownloadAllowed: true,
  screenshotAllowed: true,
  clipboardAllowed: true,
  credentialSubmissionAllowed: false,
  automationOnlyInExplicitSessions: true,
  dialogHandling: "must_respond",
  dialogTimeoutMs: 10000,
};

const BALANCED_LOW_LEVEL_POLICY: LowLevelPolicy = {
  rawCdpAllowed: false,
  jsEvalAllowed: false,
  networkInterceptionAllowed: false,
  cookieExportImportAllowed: false,
  coordinateActionsAllowed: false,
  performanceTracesAllowed: true,
};

const BALANCED_CREDENTIAL_POLICY: CredentialPolicy = {
  secretUseConfirmThreshold: "cross-site",
  secretRevealAllowed: true,
  secretAutoTypeAllowed: true,
  secretAutoPasteAllowed: true,
};

const BALANCED_PRIVACY_POLICY: PrivacyPolicy = {
  profile: "balanced",
};

export const BALANCED_PROFILE: PolicyProfile = {
  name: "balanced",
  commandPolicy: BALANCED_COMMAND_POLICY,
  filesystemPolicy: BALANCED_FILESYSTEM_POLICY,
  browserPolicy: BALANCED_BROWSER_POLICY,
  lowLevelPolicy: BALANCED_LOW_LEVEL_POLICY,
  credentialPolicy: BALANCED_CREDENTIAL_POLICY,
  privacyPolicy: BALANCED_PRIVACY_POLICY,
};

// ── Trusted Profile ─────────────────────────────────────────────────────

const TRUSTED_RISK_MATRIX: RiskDecisionMatrix = {
  low: "allow",
  moderate: "allow_with_audit",
  high: "allow_with_audit",
  critical: "require_confirmation",
};

const TRUSTED_COMMAND_POLICY: CommandPolicy = {
  allowedCommands: [],
  deniedCommands: ["format", "fdisk", "dd"],
  requireConfirmationCommands: [],
  restrictedWorkingDirectories: [],
  restrictedNetworkClasses: [],
  restrictedProcessClasses: ["kernel"],
  restrictedServiceClasses: [],
};

const TRUSTED_FILESYSTEM_POLICY: FilesystemPolicy = {
  allowedReadRoots: [],
  allowedWriteRoots: [],
  allowedDeleteRoots: [],
  recursiveDeleteDefaultBehavior: "require_confirmation",
  tempDirectoryDefaultBehavior: "allow",
};

const TRUSTED_BROWSER_POLICY: BrowserPolicy = {
  allowedDomains: [],
  blockedDomains: [],
  fileUploadAllowed: true,
  fileDownloadAllowed: true,
  screenshotAllowed: true,
  clipboardAllowed: true,
  credentialSubmissionAllowed: true,
  automationOnlyInExplicitSessions: false,
  dialogHandling: "auto_accept",
  dialogTimeoutMs: 5000,
};

const TRUSTED_LOW_LEVEL_POLICY: LowLevelPolicy = {
  rawCdpAllowed: true,
  jsEvalAllowed: true,
  networkInterceptionAllowed: true,
  cookieExportImportAllowed: true,
  coordinateActionsAllowed: true,
  performanceTracesAllowed: true,
};

const TRUSTED_CREDENTIAL_POLICY: CredentialPolicy = {
  secretUseConfirmThreshold: "none",
  secretRevealAllowed: true,
  secretAutoTypeAllowed: true,
  secretAutoPasteAllowed: true,
};

const TRUSTED_PRIVACY_POLICY: PrivacyPolicy = {
  profile: "audit",
};

export const TRUSTED_PROFILE: PolicyProfile = {
  name: "trusted",
  commandPolicy: TRUSTED_COMMAND_POLICY,
  filesystemPolicy: TRUSTED_FILESYSTEM_POLICY,
  browserPolicy: TRUSTED_BROWSER_POLICY,
  lowLevelPolicy: TRUSTED_LOW_LEVEL_POLICY,
  credentialPolicy: TRUSTED_CREDENTIAL_POLICY,
  privacyPolicy: TRUSTED_PRIVACY_POLICY,
};

// ── Profile Registry ────────────────────────────────────────────────────

const BUILT_IN_PROFILES = new Map<string, PolicyProfile>([
  ["safe", SAFE_PROFILE],
  ["balanced", BALANCED_PROFILE],
  ["trusted", TRUSTED_PROFILE],
]);

const SAFE_PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function isValidProfileName(name: string): boolean {
  return SAFE_PROFILE_NAME.test(name);
}

export function validateProfileName(name: string): { valid: boolean; error?: string } {
  if (!isValidProfileName(name)) {
    return {
      valid: false,
      error: "Profile name must be 1-64 characters and contain only letters, numbers, hyphens, and underscores.",
    };
  }
  return { valid: true };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStringArray(
  section: Record<string, unknown>,
  sectionName: string,
  field: string,
  errors: string[],
): void {
  const value = section[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${sectionName}.${field} must be an array of strings.`);
  }
}

function requireBoolean(
  section: Record<string, unknown>,
  sectionName: string,
  field: string,
  errors: string[],
): void {
  if (typeof section[field] !== "boolean") {
    errors.push(`${sectionName}.${field} must be a boolean.`);
  }
}

function requireFiniteNumber(
  section: Record<string, unknown>,
  sectionName: string,
  field: string,
  errors: string[],
): void {
  if (typeof section[field] !== "number" || !Number.isFinite(section[field])) {
    errors.push(`${sectionName}.${field} must be a finite number.`);
  }
}

function requireEnum(
  section: Record<string, unknown>,
  sectionName: string,
  field: string,
  allowed: readonly string[],
  errors: string[],
): void {
  if (!allowed.includes(section[field] as string)) {
    errors.push(`${sectionName}.${field} must be one of: ${allowed.join(", ")}.`);
  }
}

export function getBuiltInProfile(name: string): PolicyProfile | null {
  return BUILT_IN_PROFILES.get(name) ?? null;
}

export function listBuiltInProfiles(): PolicyProfile[] {
  return Array.from(BUILT_IN_PROFILES.values());
}

export function getRiskDecisionMatrix(profileName: string): RiskDecisionMatrix | null {
  const profile = getBuiltInProfile(profileName);
  if (!profile) {
    return null;
  }

  switch (profileName) {
    case "safe":
      return SAFE_RISK_MATRIX;
    case "balanced":
      return BALANCED_RISK_MATRIX;
    case "trusted":
      return TRUSTED_RISK_MATRIX;
    default:
      return null;
  }
}

// ── Profile Validation and Serialization ────────────────────────────────

export function validateProfile(profile: PolicyProfile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const candidate = profile as unknown;

  if (!isPlainRecord(candidate)) {
    return { valid: false, errors: ["Profile must be an object."] };
  }

  if (!candidate.name || typeof candidate.name !== "string") {
    errors.push("Profile name is required and must be a string.");
  } else {
    const nameValidation = validateProfileName(candidate.name);
    if (!nameValidation.valid) {
      errors.push(nameValidation.error ?? "Invalid profile name.");
    }
  }

  const commandPolicy = candidate.commandPolicy;
  if (!isPlainRecord(commandPolicy)) {
    errors.push("Profile must include commandPolicy.");
  } else {
    for (const field of [
      "allowedCommands",
      "deniedCommands",
      "requireConfirmationCommands",
      "restrictedWorkingDirectories",
      "restrictedNetworkClasses",
      "restrictedProcessClasses",
      "restrictedServiceClasses",
    ]) {
      requireStringArray(commandPolicy, "commandPolicy", field, errors);
    }
  }

  const filesystemPolicy = candidate.filesystemPolicy;
  if (!isPlainRecord(filesystemPolicy)) {
    errors.push("Profile must include filesystemPolicy.");
  } else {
    for (const field of ["allowedReadRoots", "allowedWriteRoots", "allowedDeleteRoots"]) {
      requireStringArray(filesystemPolicy, "filesystemPolicy", field, errors);
    }
    requireEnum(
      filesystemPolicy,
      "filesystemPolicy",
      "recursiveDeleteDefaultBehavior",
      ["deny", "require_confirmation"],
      errors,
    );
    requireEnum(
      filesystemPolicy,
      "filesystemPolicy",
      "tempDirectoryDefaultBehavior",
      ["allow", "require_confirmation"],
      errors,
    );
  }

  const browserPolicy = candidate.browserPolicy;
  if (!isPlainRecord(browserPolicy)) {
    errors.push("Profile must include browserPolicy.");
  } else {
    for (const field of ["allowedDomains", "blockedDomains"]) {
      requireStringArray(browserPolicy, "browserPolicy", field, errors);
    }
    for (const field of [
      "fileUploadAllowed",
      "fileDownloadAllowed",
      "screenshotAllowed",
      "clipboardAllowed",
      "credentialSubmissionAllowed",
      "automationOnlyInExplicitSessions",
    ]) {
      requireBoolean(browserPolicy, "browserPolicy", field, errors);
    }
    requireEnum(
      browserPolicy,
      "browserPolicy",
      "dialogHandling",
      ["must_respond", "auto_accept", "auto_dismiss", "defer"],
      errors,
    );
    requireFiniteNumber(browserPolicy, "browserPolicy", "dialogTimeoutMs", errors);
  }

  const lowLevelPolicy = candidate.lowLevelPolicy;
  if (!isPlainRecord(lowLevelPolicy)) {
    errors.push("Profile must include lowLevelPolicy.");
  } else {
    for (const field of [
      "rawCdpAllowed",
      "jsEvalAllowed",
      "networkInterceptionAllowed",
      "cookieExportImportAllowed",
      "coordinateActionsAllowed",
      "performanceTracesAllowed",
    ]) {
      requireBoolean(lowLevelPolicy, "lowLevelPolicy", field, errors);
    }
  }

  const credentialPolicy = candidate.credentialPolicy;
  if (!isPlainRecord(credentialPolicy)) {
    errors.push("Profile must include credentialPolicy.");
  } else {
    requireEnum(
      credentialPolicy,
      "credentialPolicy",
      "secretUseConfirmThreshold",
      ["none", "cross-site", "all"],
      errors,
    );
    for (const field of ["secretRevealAllowed", "secretAutoTypeAllowed", "secretAutoPasteAllowed"]) {
      requireBoolean(credentialPolicy, "credentialPolicy", field, errors);
    }
  }

  const privacyPolicy = candidate.privacyPolicy;
  if (!isPlainRecord(privacyPolicy)) {
    errors.push("Profile must include privacyPolicy.");
  } else {
    requireEnum(
      privacyPolicy,
      "privacyPolicy",
      "profile",
      ["strict", "balanced", "audit"],
      errors,
    );
    for (const field of ["customBlockedDomains", "customAllowedDomains"]) {
      requireStringArray(privacyPolicy, "privacyPolicy", field, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function serializeProfile(profile: PolicyProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function deserializeProfile(json: string): PolicyProfile | null {
  try {
    const profile = JSON.parse(json) as PolicyProfile;
    const validation = validateProfile(profile);
    if (!validation.valid) {
      return null;
    }
    return profile;
  } catch {
    return null;
  }
}

// ── Custom Profile Persistence ────────────────────────────────────────────

function getCustomProfilePath(name: string): string {
  const nameValidation = validateProfileName(name);
  if (!nameValidation.valid) {
    throw new Error(nameValidation.error ?? "Invalid profile name.");
  }
  const profilesDir = getPolicyProfilesDir();
  return path.join(profilesDir, `${name}.json`);
}

export function saveCustomProfile(profile: PolicyProfile): void {
  const profilesDir = getPolicyProfilesDir();
  fs.mkdirSync(profilesDir, { recursive: true });

  const validation = validateProfile(profile);
  if (!validation.valid) {
    throw new Error(`Invalid profile: ${validation.errors.join(", ")}`);
  }

  const profilePath = getCustomProfilePath(profile.name);
  fs.writeFileSync(profilePath, serializeProfile(profile), "utf-8");
}

export function loadCustomProfile(name: string): PolicyProfile | null {
  if (!validateProfileName(name).valid) {
    return null;
  }
  const profilePath = getCustomProfilePath(name);
  if (!fs.existsSync(profilePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(profilePath, "utf-8");
    return deserializeProfile(content);
  } catch {
    return null;
  }
}

export function deleteCustomProfile(name: string): boolean {
  if (!validateProfileName(name).valid) {
    return false;
  }
  const profilePath = getCustomProfilePath(name);
  if (!fs.existsSync(profilePath)) {
    return false;
  }

  try {
    fs.unlinkSync(profilePath);
    return true;
  } catch {
    return false;
  }
}

export function listCustomProfiles(): PolicyProfile[] {
  const profilesDir = getPolicyProfilesDir();
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  const profiles: PolicyProfile[] = [];
  try {
    const files = fs.readdirSync(profilesDir)
      .filter(f => f.endsWith(".json"));

    for (const file of files) {
      const profilePath = path.join(profilesDir, file);
      try {
        const content = fs.readFileSync(profilePath, "utf-8");
        const profile = deserializeProfile(content);
        if (profile) {
          profiles.push(profile);
        }
      } catch {
        // Skip invalid profiles
      }
    }
  } catch {
    // Return empty list on error
  }

  return profiles;
}

export function getAllProfiles(): PolicyProfile[] {
  const builtIn = listBuiltInProfiles();
  const custom = listCustomProfiles();
  return [...builtIn, ...custom];
}

export function getProfile(name: string): PolicyProfile | null {
  // Check built-in profiles first
  const builtIn = getBuiltInProfile(name);
  if (builtIn) {
    return builtIn;
  }

  // Check custom profiles
  return loadCustomProfile(name);
}
