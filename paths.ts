import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOME_NAME = ".browser-control";

export function getDataHome(): string {
  const override = process.env.BROWSER_CONTROL_HOME;
  if (override && override.trim()) {
    return override.trim();
  }
  return path.join(os.homedir(), DEFAULT_HOME_NAME);
}

/**
 * Ensure the data-home directory tree exists at an explicit path.
 *
 * Reused by both `ensureDataHome()` (reads process.env) and
 * `loadConfig()` (resolves the path from its own env override).
 */
export function ensureDataHomeAtPath(home: string): string {
  const dirs = [
    home,
    path.join(home, "reports"),
    path.join(home, "logs"),
    path.join(home, ".interop"),
    path.join(home, "skills"),
    path.join(home, "policy-profiles"),
    path.join(home, "profiles"),
    path.join(home, "knowledge"),
    path.join(home, "knowledge", "interaction-skills"),
    path.join(home, "knowledge", "domain-skills"),
    path.join(home, "services"),
    path.join(home, "providers"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return home;
}

export function ensureDataHome(): string {
  return ensureDataHomeAtPath(getDataHome());
}

export function getMemoryStorePath(): string {
  return path.join(getDataHome(), "memory.sqlite");
}

export function getReportsDir(): string {
  return path.join(getDataHome(), "reports");
}

export function getInteropDir(): string {
  return path.join(getDataHome(), ".interop");
}

export function getChromeDebugPath(): string {
  return path.join(getInteropDir(), "chrome-debug.json");
}

export function getWslBridgePidPath(port: number): string {
  return path.join(getInteropDir(), `wsl-cdp-bridge-${port}.pid`);
}

export function getPidFilePath(): string {
  return path.join(getInteropDir(), "daemon.pid");
}

export function getLogsDir(): string {
  return path.join(getDataHome(), "logs");
}

export function getSkillsDataDir(): string {
  return path.join(getDataHome(), "skills");
}

export function getDaemonStatusPath(): string {
  return path.join(getInteropDir(), "daemon-status.json");
}

export function getPolicyProfilesDir(): string {
  return path.join(getDataHome(), "policy-profiles");
}

export function getProfilesDir(): string {
  return path.join(getDataHome(), "profiles");
}

// ── Knowledge Directories (Section 9) ────────────────────────────────

/** Top-level knowledge directory */
export function getKnowledgeDir(): string {
  return path.join(getDataHome(), "knowledge");
}

/** Interaction skills stored under <data-home>/knowledge/interaction-skills/ */
export function getInteractionSkillsDir(): string {
  return path.join(getKnowledgeDir(), "interaction-skills");
}

/** Domain skills stored under <data-home>/knowledge/domain-skills/ */
export function getDomainSkillsDir(): string {
  return path.join(getKnowledgeDir(), "domain-skills");
}

// ── Service Registry (Section 14) ────────────────────────────────────

/** Directory for the global service registry */
export function getServicesDir(): string {
  return path.join(getDataHome(), "services");
}

/** Path to the service registry JSON file */
export function getServiceRegistryPath(): string {
  return path.join(getServicesDir(), "registry.json");
}

// ── Provider Registry (Section 15) ───────────────────────────────────

/** Path to the provider registry JSON file */
export function getProviderRegistryPath(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "providers", "registry.json");
}

// ── Debug Bundles and Observability (Section 10) ─────────────────────

/** Directory for debug bundles */
export function getDebugBundleDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "debug-bundles");
}

/** Ensure debug bundle directory exists */
export function ensureDebugBundleDir(dataHome?: string): string {
  const dir = getDebugBundleDir(dataHome);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory for observability reports */
export function getObservabilityDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "observability");
}

/** Ensure observability directory exists */
export function ensureObservabilityDir(dataHome?: string): string {
  const dir = getObservabilityDir(dataHome);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
