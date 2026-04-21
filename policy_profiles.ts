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
  RiskLevel,
  PolicyDecision,
} from "./policy";
import fs from "node:fs";
import path from "node:path";
import { getPolicyProfilesDir } from "./paths";

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
};

const SAFE_LOW_LEVEL_POLICY: LowLevelPolicy = {
  rawCdpAllowed: false,
  jsEvalAllowed: false,
  networkInterceptionAllowed: false,
  cookieExportImportAllowed: false,
  coordinateActionsAllowed: false,
  performanceTracesAllowed: false,
};

export const SAFE_PROFILE: PolicyProfile = {
  name: "safe",
  commandPolicy: SAFE_COMMAND_POLICY,
  filesystemPolicy: SAFE_FILESYSTEM_POLICY,
  browserPolicy: SAFE_BROWSER_POLICY,
  lowLevelPolicy: SAFE_LOW_LEVEL_POLICY,
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
};

const BALANCED_LOW_LEVEL_POLICY: LowLevelPolicy = {
  rawCdpAllowed: false,
  jsEvalAllowed: false,
  networkInterceptionAllowed: false,
  cookieExportImportAllowed: false,
  coordinateActionsAllowed: false,
  performanceTracesAllowed: true,
};

export const BALANCED_PROFILE: PolicyProfile = {
  name: "balanced",
  commandPolicy: BALANCED_COMMAND_POLICY,
  filesystemPolicy: BALANCED_FILESYSTEM_POLICY,
  browserPolicy: BALANCED_BROWSER_POLICY,
  lowLevelPolicy: BALANCED_LOW_LEVEL_POLICY,
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
};

const TRUSTED_LOW_LEVEL_POLICY: LowLevelPolicy = {
  rawCdpAllowed: true,
  jsEvalAllowed: true,
  networkInterceptionAllowed: true,
  cookieExportImportAllowed: true,
  coordinateActionsAllowed: true,
  performanceTracesAllowed: true,
};

export const TRUSTED_PROFILE: PolicyProfile = {
  name: "trusted",
  commandPolicy: TRUSTED_COMMAND_POLICY,
  filesystemPolicy: TRUSTED_FILESYSTEM_POLICY,
  browserPolicy: TRUSTED_BROWSER_POLICY,
  lowLevelPolicy: TRUSTED_LOW_LEVEL_POLICY,
};

// ── Profile Registry ────────────────────────────────────────────────────

const BUILT_IN_PROFILES = new Map<string, PolicyProfile>([
  ["safe", SAFE_PROFILE],
  ["balanced", BALANCED_PROFILE],
  ["trusted", TRUSTED_PROFILE],
]);

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

  if (!profile.name || typeof profile.name !== "string") {
    errors.push("Profile name is required and must be a string.");
  }

  if (!profile.commandPolicy || typeof profile.commandPolicy !== "object") {
    errors.push("Profile must include commandPolicy.");
  }

  if (!profile.filesystemPolicy || typeof profile.filesystemPolicy !== "object") {
    errors.push("Profile must include filesystemPolicy.");
  }

  if (!profile.browserPolicy || typeof profile.browserPolicy !== "object") {
    errors.push("Profile must include browserPolicy.");
  }

  if (!profile.lowLevelPolicy || typeof profile.lowLevelPolicy !== "object") {
    errors.push("Profile must include lowLevelPolicy.");
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
