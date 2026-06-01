import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const DEFAULT_HOME_NAME = ".browser-control";
export const DATA_HOME_SCHEMA_VERSION = 2;
const COMPATIBILITY_ALIAS_TTL_DAYS = 365;
const COMPATIBILITY_ALIAS_TTL_MS =
  COMPATIBILITY_ALIAS_TTL_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_COMPATIBILITY_ALIASES: Record<string, string> = {
  ".interop": "interop",
  "chrome_pid.txt": "interop/chrome.pid",
  screenshots: "evidence/screenshots",
  "memory.sqlite": "memory/memory.sqlite",
  "automation-helpers": "helpers",
};
export interface RuntimeSessionInfo {
  id: string;
  name: string;
  createdAt: string;
}
interface CompatibilityAliasEntry {
  current: string;
  createdAt: string;
  expiresAt: string;
}
type DataHomeManifest = Record<string, unknown> & {
  compatibilityAliases?: Record<string, unknown>;
  createdAt?: unknown;
  layout?: unknown;
  product?: unknown;
  schemaVersion?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIsoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function expiresAtFor(createdAt: string): string {
  return new Date(
    Date.parse(createdAt) + COMPATIBILITY_ALIAS_TTL_MS,
  ).toISOString();
}

function normalizeCompatibilityAliases(
  aliases: Record<string, unknown> | undefined,
  manifestCreatedAt: unknown,
  now: Date,
): Record<string, CompatibilityAliasEntry> {
  const nowTime = now.getTime();
  const nowIso = now.toISOString();
  const createdFallback = validIsoOrUndefined(manifestCreatedAt) ?? nowIso;
  const normalized: Record<string, CompatibilityAliasEntry> = {};
  const expired = new Set<string>();
  for (const [legacy, rawEntry] of Object.entries(aliases ?? {})) {
    let current: string | undefined;
    let createdAt = createdFallback;
    let expiresAt: string | undefined;
    if (typeof rawEntry === "string") {
      current = rawEntry;
    } else if (isObject(rawEntry)) {
      current = typeof rawEntry.current === "string" ? rawEntry.current : undefined;
      createdAt = validIsoOrUndefined(rawEntry.createdAt) ?? createdFallback;
      expiresAt = validIsoOrUndefined(rawEntry.expiresAt);
    }
    if (!current) continue;
    expiresAt ??= expiresAtFor(createdAt);
    if (Date.parse(expiresAt) <= nowTime) {
      expired.add(legacy);
      continue;
    }
    normalized[legacy] = { current, createdAt, expiresAt };
  }
  for (const [legacy, current] of Object.entries(DEFAULT_COMPATIBILITY_ALIASES)) {
    if (normalized[legacy] || expired.has(legacy)) continue;
    const createdAt = nowIso;
    normalized[legacy] = { current, createdAt, expiresAt: expiresAtFor(createdAt) };
  }
  return normalized;
}

function createDataHomeManifest(now = new Date()): DataHomeManifest {
  const createdAt = now.toISOString();
  return {
    product: "browser-control",
    schemaVersion: DATA_HOME_SCHEMA_VERSION,
    createdAt,
    layout: "v2",
    compatibilityAliases: normalizeCompatibilityAliases(undefined, createdAt, now),
  };
}

function upsertDataHomeManifest(manifestPath: string): void {
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(createDataHomeManifest(), null, 2)}\n`,
      { mode: 0o600 },
    );
    return;
  }
  let parsed: DataHomeManifest;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as DataHomeManifest;
  } catch {
    return;
  }
  if (!isObject(parsed)) return;
  const now = new Date();
  const createdAt = validIsoOrUndefined(parsed.createdAt) ?? now.toISOString();
  const next: DataHomeManifest = {
    ...parsed,
    product: typeof parsed.product === "string" ? parsed.product : "browser-control",
    schemaVersion: typeof parsed.schemaVersion === "number"
      ? parsed.schemaVersion
      : DATA_HOME_SCHEMA_VERSION,
    createdAt,
    layout: typeof parsed.layout === "string" ? parsed.layout : "v2",
    compatibilityAliases: normalizeCompatibilityAliases(
      isObject(parsed.compatibilityAliases) ? parsed.compatibilityAliases : undefined,
      createdAt,
      now,
    ),
  };
  if (JSON.stringify(parsed) === JSON.stringify(next)) return;
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
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

function dataHomeReadmeText(): string {
  return [
    "# Browser Control Data Home",
    "",
    "This directory stores Browser Control runtime data, package data, browser state, evidence, and local configuration.",
    "",
    "Do not delete folders blindly. Use `bc data doctor --json` to inspect the layout and `bc data cleanup` for retention-safe cleanup.",
    "",
    "Important folders:",
    "",
    "Most feature folders are created lazily when that feature first writes data.",
    "",
    "- `automations/`: saved automations, schedules, and run records.",
    "- `backups/`: local backup artifacts.",
    "- `browser/profiles/`: browser profiles, cookies, and session state. Do not delete unless you want to lose browser logins.",
    "- `cache/`: runtime caches that can be regenerated.",
    "- `config/`: user-scoped Browser Control configuration.",
    "- `evidence/`: screenshots and debug bundles.",
    "- `helpers/`: automation helper scripts and registries used by packages.",
    "- `interop/`: runtime coordination files such as PID files, auth keys, and browser debug metadata. Do not delete while Browser Control is running.",
    "- `knowledge/`: local knowledge artifacts.",
    "- `logs/`: runtime logs for troubleshooting.",
    "- `memory/`: local SQLite memory, embeddings, and knowledge caches.",
    "- `observability/`: screencasts, receipts, and runtime evidence metadata.",
    "- `packages/`: installed Automation Packages, drafts, and evaluations.",
    "- `policy/`: approval records and policy profiles.",
    "- `providers/`: browser provider registry data.",
    "- `reports/`: exports, audits, and health reports.",
    "- `services/`: stable local service registry data.",
    "- `skills/`: skill data retained for compatibility.",
    "- `runtime/sessions/`: per-session runtime artifacts.",
    "- `runtime/temp/`: temporary files. Safe cleanup path: `bc data cleanup`.",
    "- `runtime/locks/`: lock files. Do not delete while Browser Control is running.",
    "- `secrets/`: secret metadata and credential storage. Do not copy into support bundles.",
    "- `state/`: persistent application state. Export before modifying.",
    "- `workflows/`: workflow definitions, runs, and approvals.",
    "- `legacy/`: preserved old non-core data. Inspect manually before deleting.",
    "",
    "Safe cleanup rule:",
    "",
    "- `bc data cleanup` is dry-run by default.",
    "- Destructive cleanup requires `--dry-run=false --confirm=DELETE_RUNTIME_TEMP`.",
    "- Cleanup targets retention-safe runtime temp files only.",
    "",
  ].join("\n");
}

export function getDataHome(): string {
  const override = process.env.BROWSER_CONTROL_HOME;
  let resolved: string;
  if (override && override.trim()) {
    resolved = path.resolve(override.trim());
  } else {
    resolved = path.resolve(path.join(os.homedir(), DEFAULT_HOME_NAME));
  }
  assertSafeDataHome(resolved, override?.trim());
  return resolved;
}
function getUnsafeRoots(): Set<string> {
  const visibleUserFolders = ["Desktop", "Documents", "Downloads"].map((folder) =>
    path.join(os.homedir(), folder),
  );
  return new Set([
    path.resolve(os.homedir()).toLowerCase(),
    ...visibleUserFolders.map((folder) => path.resolve(folder).toLowerCase()),
    path.resolve("C:\\").toLowerCase(),
    path.resolve("C:").toLowerCase(),
    path.resolve("/").toLowerCase(),
  ]);
}
const ALLOW_UNSAFE_ENV = "BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME";
function assertSafeDataHome(resolved: string, rawOverride?: string): void {
  const allowUnsafe = process.env[ALLOW_UNSAFE_ENV] === "1" ||
    process.env[ALLOW_UNSAFE_ENV] === "true";
  if (allowUnsafe) return;
  if (!resolved || resolved.length === 0) {
    throw new Error(
      "Refusing unsafe Browser Control data home: empty path. Use ~/.browser-control or an isolated temp directory.",
    );
  }
  const normalized = resolved.toLowerCase().replace(/[/\\]+$/, "");
  const homedir = path.resolve(os.homedir()).toLowerCase().replace(/[/\\]+$/, "");
  if (normalized === homedir) {
    throw new Error(
      `Refusing unsafe Browser Control data home: ${resolved}. Use ~/.browser-control or an isolated temp directory.`,
    );
  }
  // Reject drive root (C:\), filesystem root (/), and the repo root
  const repoRoot = path.resolve(__dirname, "..", "..").toLowerCase().replace(/[/\\]+$/, "");
  for (const root of getUnsafeRoots()) {
    const normalizedRoot = root.replace(/[/\\]+$/, "");
    if (normalized === normalizedRoot) {
      throw new Error(
        `Refusing unsafe Browser Control data home: ${resolved}. Use ~/.browser-control or an isolated temp directory.`,
      );
    }
  }
  if (normalized === repoRoot) {
    throw new Error(
      `Refusing unsafe Browser Control data home: ${resolved}. Use ~/.browser-control or an isolated temp directory.`,
    );
  }
}
/**
 * Ensure the data-home directory tree exists at an explicit path.
 *
 * Reused by both `ensureDataHome()` (reads process.env) and
 * `loadConfig()` (resolves the path from its own env override).
 */
export function ensureDataHomeAtPath(home: string): string {
  assertSafeDataHome(path.resolve(home), home);
  const dirs = [
    home,
    path.join(home, "config"),
    path.join(home, "interop"),
    path.join(home, "runtime"),
    path.join(home, "secrets"),
    path.join(home, "state"),
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
  upsertDataHomeManifest(manifestPath);
  const rootReadme = path.join(home, "README.md");
  if (!fs.existsSync(rootReadme)) {
    fs.writeFileSync(rootReadme, dataHomeReadmeText(), { mode: 0o600 });
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
        "The `.vault-key` file is the local fallback vault decryption key.",
        "Never commit, sync, or back up `.vault-key` alongside vault contents.",
        "Treat `.vault-key` like a password: file possession can decrypt local fallback vault entries.",
        "On Windows, POSIX file modes are advisory; protect this folder with user/account-level access control.",
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
function slugifyRuntimeName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return slug || "session";
}
export function getStructuredSessionRuntimeDir(session: RuntimeSessionInfo, dataHome?: string): string {
  const shortId = session.id.replace(/-/gu, "").slice(0, 8) || "session";
  const folderName = `${slugifyRuntimeName(session.name)}_${shortId}`;
  return path.join(getRuntimeDir(dataHome), folderName);
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
