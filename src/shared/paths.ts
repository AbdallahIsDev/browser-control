import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOME_NAME = ".browser-control";
export const DATA_HOME_SCHEMA_VERSION = 2;

export interface RuntimeSessionInfo {
  id: string;
  name: string;
  createdAt: string;
}

function copyFileIfMissing(source: string, target: string): void {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  if (process.platform !== "win32") fs.chmodSync(target, 0o600);
}

function copyDirFilesIfMissing(source: string, target: string): void {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return;
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isFile()) copyFileIfMissing(sourcePath, targetPath);
  }
}

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
    path.join(home, "automations"),
    path.join(home, "automations", "saved"),
    path.join(home, "automations", "runs"),
    path.join(home, "automations", "schedules"),
    path.join(home, "backups"),
    path.join(home, "browser"),
    path.join(home, "browser", "downloads"),
    path.join(home, "browser", "profiles"),
    path.join(home, "cache"),
    path.join(home, "config"),
    path.join(home, "evidence"),
    path.join(home, "evidence", "debug-bundles"),
    path.join(home, "evidence", "receipts"),
    path.join(home, "evidence", "screencasts"),
    path.join(home, "evidence", "screenshots"),
    path.join(home, "helpers"),
    path.join(home, "helpers", "by-package"),
    path.join(home, "helpers", "by-site"),
    path.join(home, "helpers", "quarantine"),
    path.join(home, "helpers", "tests"),
    path.join(home, "interop"),
    path.join(home, "logs"),
    path.join(home, "memory"),
    path.join(home, "memory", "embeddings"),
    path.join(home, "memory", "knowledge"),
    path.join(home, "packages"),
    path.join(home, "packages", "evals"),
    path.join(home, "packages", "installed"),
    path.join(home, "policy"),
    path.join(home, "policy", "approvals"),
    path.join(home, "policy", "profiles"),
    path.join(home, "reports"),
    path.join(home, "reports", "audits"),
    path.join(home, "reports", "exports"),
    path.join(home, "reports", "health"),
    path.join(home, "runtime"),
    path.join(home, "runtime", "locks"),
    path.join(home, "runtime", "sessions"),
    path.join(home, "runtime", "temp"),
    path.join(home, "secrets"),
    path.join(home, "state"),
    path.join(home, "trading"),
    path.join(home, "trading", "evidence"),
    path.join(home, "trading", "journals"),
    path.join(home, "trading", "orders"),
    path.join(home, "trading", "positions"),
    path.join(home, "trading", "risk-snapshots"),
    path.join(home, "trading", "supervisor-jobs"),
    path.join(home, "trading", "trade-plans"),
    path.join(home, "workflows"),
    path.join(home, "workflows", "approvals"),
    path.join(home, "workflows", "definitions"),
    path.join(home, "workflows", "runs"),
    // Compatibility aliases retained for one transition period.
    path.join(home, "reports"),
    path.join(home, "runtime"),
    path.join(home, "logs"),
    path.join(home, ".interop"),
    path.join(home, "config"),
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
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to use symlinked Browser Control data directory: ${dir}`);
      }
      fs.chmodSync(dir, 0o700);
    }
  }

  const manifestPath = getDataHomeManifestPath(home);
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          product: "browser-control",
          schemaVersion: DATA_HOME_SCHEMA_VERSION,
          createdAt: new Date().toISOString(),
          layout: "v2",
          compatibilityAliases: {
            ".interop": "interop",
            "chrome_pid.txt": "interop/chrome.pid",
            screenshots: "evidence/screenshots",
            "memory.sqlite": "memory/memory.sqlite",
            "automation-helpers": "helpers",
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }

  const secretsReadme = path.join(home, "secrets", "README.md");
  if (!fs.existsSync(secretsReadme)) {
    fs.writeFileSync(
      secretsReadme,
      [
        "# Browser Control Secrets",
        "",
        "Provider keys and other secrets are stored separately from normal preferences.",
        "Values in this folder must be redacted from UI, logs, debug bundles, and exports.",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  }

  copyDirFilesIfMissing(path.join(home, ".interop"), path.join(home, "interop"));
  copyFileIfMissing(path.join(home, "chrome_pid.txt"), path.join(home, "interop", "chrome.pid"));
  copyDirFilesIfMissing(path.join(home, "screenshots"), path.join(home, "evidence", "screenshots"));
  copyDirFilesIfMissing(path.join(home, "debug-bundles"), path.join(home, "evidence", "debug-bundles"));
  copyDirFilesIfMissing(path.join(home, "automation-helpers"), path.join(home, "helpers"));
  copyFileIfMissing(path.join(home, "memory.sqlite"), path.join(home, "memory", "memory.sqlite"));
  copyFileIfMissing(path.join(home, "memory.sqlite-shm"), path.join(home, "memory", "memory.sqlite-shm"));
  copyFileIfMissing(path.join(home, "memory.sqlite-wal"), path.join(home, "memory", "memory.sqlite-wal"));
  migrateProfiles(home);
  return home;
}

/**
 * Robustly migrate legacy profiles/ to browser/profiles/
 *
 * - Copies missing profile folders from legacy to canonical.
 * - Does not delete legacy profiles.
 * - Creates a migration report if any migration happened.
 */
function migrateProfiles(home: string): void {
  const legacy = path.join(home, "profiles");
  const canonical = path.join(home, "browser", "profiles");

  if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) return;

  const legacyProfiles = fs.readdirSync(legacy, { withFileTypes: true });
  if (legacyProfiles.length === 0) return;

  fs.mkdirSync(canonical, { recursive: true, mode: 0o700 });
  const migrated: string[] = [];
  const conflicts: string[] = [];

  for (const entry of legacyProfiles) {
    if (!entry.isDirectory()) continue;
    const source = path.join(legacy, entry.name);
    const target = path.join(canonical, entry.name);

    if (!fs.existsSync(target)) {
      // Safe to copy entire profile folder
      fs.cpSync(source, target, { recursive: true, force: false });
      migrated.push(entry.name);
    } else {
      conflicts.push(entry.name);
    }
  }

  if (migrated.length > 0 || conflicts.length > 0) {
    const reportPath = path.join(home, "reports", "migrations", `profiles-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          legacyPath: legacy,
          canonicalPath: canonical,
          migrated,
          conflicts,
          note: "Legacy profiles were preserved. Conflicts mean both locations had a profile with the same name; canonical was preferred.",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
}

export function ensureDataHome(): string {
  return ensureDataHomeAtPath(getDataHome());
}

export function getDataHomeManifestPath(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "manifest.json");
}

export function getStateDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "state");
}

export function getSecretsDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "secrets");
}

export function getMemoryDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "memory");
}

export function getLegacyMemoryStorePath(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "memory.sqlite");
}

export function getMemoryStorePath(dataHome?: string): string {
  const home = dataHome ?? getDataHome();
  const canonical = path.join(home, "memory", "memory.sqlite");
  const legacy = getLegacyMemoryStorePath(home);
  if (fs.existsSync(canonical)) return canonical;
  if (fs.existsSync(legacy)) return legacy;
  return canonical;
}

export function getReportsDir(): string {
  return path.join(getDataHome(), "reports");
}

export function getRuntimeDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "runtime");
}

export function getRuntimeTempDir(dataHome?: string): string {
  return path.join(getRuntimeDir(dataHome), "temp");
}

export function getRuntimeLocksDir(dataHome?: string): string {
  return path.join(getRuntimeDir(dataHome), "locks");
}

export function getSessionRuntimeDir(sessionId: string, dataHome?: string): string {
  return path.join(getRuntimeDir(dataHome), sessionId);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function slugifyRuntimeName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return slug || "session";
}

export function getStructuredSessionRuntimeDir(session: RuntimeSessionInfo, dataHome?: string): string {
  const created = new Date(session.createdAt);
  const safeDate = Number.isNaN(created.getTime()) ? new Date() : created;
  const date = `${safeDate.getFullYear()}-${pad2(safeDate.getMonth() + 1)}-${pad2(safeDate.getDate())}`;
  const time = `${pad2(safeDate.getHours())}-${pad2(safeDate.getMinutes())}`;
  const shortId = session.id.replace(/-/gu, "").slice(0, 8) || "session";
  const folderName = `${time}_${slugifyRuntimeName(session.name)}_${shortId}`;

  return path.join(getRuntimeDir(dataHome), date, folderName);
}

export function ensureStructuredSessionRuntimeDir(session: RuntimeSessionInfo, dataHome?: string): string {
  const runtimeDir = getStructuredSessionRuntimeDir(session, dataHome);
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

  const manifestPath = path.join(runtimeDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    const manifest = {
      schemaVersion: 1,
      sessionId: session.id,
      name: session.name,
      createdAt: session.createdAt,
      folderName: path.basename(runtimeDir),
      createdAtLocal: new Date(session.createdAt).toLocaleString(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }

  return runtimeDir;
}

export function getSessionScreenshotsDir(sessionId: string, dataHome?: string): string {
  return path.join(getSessionRuntimeDir(sessionId, dataHome), "screenshots");
}

export function getSessionDownloadsDir(sessionId: string, dataHome?: string): string {
  return path.join(getSessionRuntimeDir(sessionId, dataHome), "downloads");
}

export function getInteropDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "interop");
}

export function getLegacyInteropDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), ".interop");
}

export function getChromeDebugPath(dataHome?: string): string {
  const canonical = path.join(getInteropDir(dataHome), "chrome-debug.json");
  const legacy = path.join(getLegacyInteropDir(dataHome), "chrome-debug.json");
  if (fs.existsSync(canonical)) return canonical;
  if (fs.existsSync(legacy)) return legacy;
  return canonical;
}

export function getWslBridgePidPath(port: number): string {
  return path.join(getInteropDir(), `wsl-cdp-bridge-${port}.pid`);
}

export function getPidFilePath(): string {
  return path.join(getInteropDir(), "daemon.pid");
}

export function getChromePidPath(dataHome?: string): string {
  return path.join(getInteropDir(dataHome), "chrome.pid");
}

export function getLogsDir(): string {
  return path.join(getDataHome(), "logs");
}

export function getConfigDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "config");
}

export function getUserConfigPath(dataHome?: string): string {
  return path.join(getConfigDir(dataHome), "config.json");
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

/**
 * Get the browser profiles directory, respecting legacy compatibility.
 *
 * - Returns the canonical browser/profiles/ directory if it exists.
 * - If only legacy profiles/ exists, returns it (it will be migrated next time ensureDataHome is called).
 * - Defaults to canonical path for first-run.
 */
export function getProfilesDir(): string {
	const home = getDataHome();
	const canonical = path.join(home, "browser", "profiles");
	const legacy = path.join(home, "profiles");

	const canonicalExists = fs.existsSync(canonical);
	const legacyExists = fs.existsSync(legacy);

	// If canonical exists, it is the standard.
	if (canonicalExists) return canonical;

	// If only legacy exists, use it as a fallback.
	if (legacyExists) return legacy;

	// Neither exists, return canonical (standard for new installations).
	return canonical;
}

export function getEvidenceDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "evidence");
}

export function getEvidenceScreenshotsDir(dataHome?: string): string {
  return path.join(getEvidenceDir(dataHome), "screenshots");
}

export function getHelpersDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "helpers");
}

export function getAutomationHelpersRegistryPath(dataHome?: string): string {
  return path.join(getHelpersDir(dataHome), "registry.json");
}

export function getAutomationsDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "automations");
}

export function getWorkflowsDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "workflows");
}

export function getTradingDir(dataHome?: string): string {
  return path.join(dataHome ?? getDataHome(), "trading");
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
  const home = dataHome ?? getDataHome();
  const canonical = path.join(home, "config", "providers.json");
  const legacy = path.join(home, "providers", "registry.json");
  return fs.existsSync(canonical) || !fs.existsSync(legacy) ? canonical : legacy;
}

// ── Debug Bundles and Observability (Section 10) ─────────────────────

/** Directory for debug bundles */
export function getDebugBundleDir(dataHome?: string): string {
  const home = dataHome ?? getDataHome();
  const canonical = path.join(home, "evidence", "debug-bundles");
  const legacy = path.join(home, "debug-bundles");
  return fs.existsSync(canonical) || !fs.existsSync(legacy) ? canonical : legacy;
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

// ── Screencast and Debug Receipts (Section 26) ─────────────────────

/** Directory for session screencast artifacts */
export function getSessionScreencastDir(sessionId: string, dataHome?: string): string {
  return path.join(getObservabilityDir(dataHome), "screencasts", sessionId);
}

/** Ensure session screencast directory exists */
export function ensureSessionScreencastDir(sessionId: string, dataHome?: string): string {
  const dir = getSessionScreencastDir(sessionId, dataHome);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory for session debug receipt artifacts */
export function getSessionReceiptDir(sessionId: string, dataHome?: string): string {
  return path.join(getObservabilityDir(dataHome), "receipts", sessionId);
}

/** Ensure session receipt directory exists */
export function ensureSessionReceiptDir(sessionId: string, dataHome?: string): string {
  const dir = getSessionReceiptDir(sessionId, dataHome);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Validate that a user-provided output path is safe (no traversal, within data home) */
export function isSafeArtifactPath(userPath: string, dataHome?: string): boolean {
  if (!userPath || typeof userPath !== "string") return false;
  const resolved = path.resolve(userPath);
  const home = dataHome ?? getDataHome();
  const resolvedHome = path.resolve(home);
  const relative = path.relative(resolvedHome, resolved);
  // Disallow traversal outside data home and absolute paths outside data home
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
