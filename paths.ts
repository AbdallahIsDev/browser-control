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
