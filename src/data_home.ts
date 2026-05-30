import fs from "node:fs";
import path from "node:path";
import {
	DATA_HOME_SCHEMA_VERSION,
	ensureDataHomeAtPath,
	getAutomationHelpersRegistryPath,
	getDataHome,
	getDataHomeManifestPath,
	getEvidenceScreenshotsDir,
	getHelpersDir,
	getInteropDir,
	getMemoryStorePath,
	getRuntimeTempDir,
} from "./shared/paths";

export interface DataHomeDirectoryReport {
	present: string[];
	missing: string[];
	inventory: DataHomeDirectoryInventoryEntry[];
}

export interface DataHomeDirectoryInventoryEntry {
	path: string;
	present: boolean;
	purpose: string;
	sizeBytes: number;
	stale: boolean;
	staleReason?: string;
	safeToDelete: string;
}

export interface DataHomeLegacyAlias {
	legacy: string;
	current: string;
	present: boolean;
	aliased: boolean;
}

export interface DataHomeReport {
	home: string;
	manifestPath: string;
	schemaVersion: number;
	sizeBytes: number;
	directories: DataHomeDirectoryReport;
	legacyAliases: DataHomeLegacyAlias[];
	userEditable: string[];
	protectedPaths: string[];
}

export interface CleanupCandidate {
	path: string;
	reason: string;
	sizeBytes: number;
	ageHours: number;
}

export interface CleanupResult {
	dryRun: boolean;
	candidates: CleanupCandidate[];
	deleted: string[];
	reclaimedBytes: number;
}

export interface DataExportResult {
	success: boolean;
	exportDir: string;
	manifestPath: string;
	filesCopied: number;
}

const TARGET_DIRS = [
	"automations",
	"automations/saved",
	"automations/runs",
	"automations/schedules",
	"backups",
	"browser",
	"browser/profiles",
	"browser/downloads",
	"cache",
	"config",
	"evidence",
	"evidence/debug-bundles",
	"evidence/receipts",
	"evidence/screencasts",
	"evidence/screenshots",
	"helpers",
	"helpers/by-site",
	"helpers/by-package",
	"helpers/quarantine",
	"helpers/tests",
	"interop",
	"logs",
	"memory",
	"memory/embeddings",
	"memory/knowledge",
	"packages",
	"packages/installed",
	"packages/evals",
	"packages/drafts",
	"policy",
	"policy/approvals",
	"policy/profiles",
	"reports",
	"reports/audits",
	"reports/exports",
	"reports/health",
	"runtime",
	"runtime/sessions",
	"runtime/temp",
	"runtime/locks",
	"secrets",
	"state",
	"legacy",
	"workflows",
	"workflows/definitions",
	"workflows/runs",
	"workflows/approvals",
	"skills",
	"policy-profiles",
	"profiles",
	"knowledge",
	"knowledge/interaction-skills",
	"knowledge/domain-skills",
	"services",
	"providers",
];

const DIRECTORY_DESCRIPTIONS: Record<string, { purpose: string; safeToDelete: string }> = {
	automations: {
		purpose: "Saved automation metadata and run records.",
		safeToDelete: "No. Export or remove individual automations first.",
	},
	"automations/saved": {
		purpose: "Saved automation definitions.",
		safeToDelete: "No. Contains user-created automation definitions.",
	},
	"automations/runs": {
		purpose: "Automation run history.",
		safeToDelete: "Only if run history is no longer needed.",
	},
	"automations/schedules": {
		purpose: "Scheduled automation metadata.",
		safeToDelete: "No. Use scheduler commands to remove schedules.",
	},
	backups: {
		purpose: "Local backup artifacts created by Browser Control maintenance tasks.",
		safeToDelete: "Only after confirming newer backups or exports exist.",
	},
	browser: {
		purpose: "Browser-owned profiles and downloads.",
		safeToDelete: "No. Contains browser state.",
	},
	"browser/profiles": {
		purpose: "Browser profiles, cookies, sessions, and local browser state.",
		safeToDelete: "No. Deleting loses browser login/session state.",
	},
	"browser/downloads": {
		purpose: "Browser downloads captured during automation runs.",
		safeToDelete: "Only after reviewing and exporting needed files.",
	},
	cache: {
		purpose: "Runtime caches that can be regenerated.",
		safeToDelete: "Usually yes when Browser Control is stopped.",
	},
	config: {
		purpose: "User-scoped Browser Control configuration.",
		safeToDelete: "No. Use bc config commands to change settings.",
	},
	evidence: {
		purpose: "Evidence captured for runs, failures, and reports.",
		safeToDelete: "Only after exporting needed evidence.",
	},
	"evidence/debug-bundles": {
		purpose: "Debug bundles for failed runs.",
		safeToDelete: "Only after support/debugging no longer needs them.",
	},
	"evidence/receipts": {
		purpose: "Execution receipts and trust/audit proof artifacts.",
		safeToDelete: "Only after exporting needed receipts.",
	},
	"evidence/screencasts": {
		purpose: "Recorded browser screencast evidence.",
		safeToDelete: "Only after exporting needed videos.",
	},
	"evidence/screenshots": {
		purpose: "Screenshots captured by browser tasks.",
		safeToDelete: "Only after exporting needed screenshots.",
	},
	helpers: {
		purpose: "Validated automation helper scripts and registry data.",
		safeToDelete: "No. Remove helpers through helper/package workflows.",
	},
	"helpers/by-site": {
		purpose: "Site-specific automation helpers.",
		safeToDelete: "No. These may be reused by packages.",
	},
	"helpers/by-package": {
		purpose: "Package-scoped automation helpers.",
		safeToDelete: "No. These may be required by installed packages.",
	},
	"helpers/quarantine": {
		purpose: "Rejected or unsafe helper drafts retained for review.",
		safeToDelete: "Yes, after review.",
	},
	"helpers/tests": {
		purpose: "Helper validation test artifacts.",
		safeToDelete: "Usually yes.",
	},
	interop: {
		purpose: "Runtime interop files such as auth keys, PID files, and browser debug metadata.",
		safeToDelete: "No while Browser Control or Chrome automation is running.",
	},
	logs: {
		purpose: "Runtime and daemon logs.",
		safeToDelete: "Only after exporting logs needed for support.",
	},
	memory: {
		purpose: "Local memory, SQLite state, embeddings, and knowledge caches.",
		safeToDelete: "No. Use export/backup first.",
	},
	"memory/embeddings": {
		purpose: "Embedding cache for local knowledge and memory search.",
		safeToDelete: "Only if regeneration cost is acceptable.",
	},
	"memory/knowledge": {
		purpose: "Knowledge cache files.",
		safeToDelete: "Only if regeneration cost is acceptable.",
	},
	packages: {
		purpose: "Automation Package registry, installed packages, drafts, and evals.",
		safeToDelete: "No. Use package commands to remove packages.",
	},
	"packages/installed": {
		purpose: "Installed Automation Packages.",
		safeToDelete: "No. Use package remove.",
	},
	"packages/evals": {
		purpose: "Package evaluation results.",
		safeToDelete: "Only after exporting needed eval history.",
	},
	"packages/drafts": {
		purpose: "Draft Automation Packages created from recordings.",
		safeToDelete: "Only if drafts are no longer needed.",
	},
	policy: {
		purpose: "Policy approvals, profiles, and trust metadata.",
		safeToDelete: "No. Use policy/config commands.",
	},
	"policy/approvals": {
		purpose: "Persisted policy approval decisions.",
		safeToDelete: "Only if approval history can be reset.",
	},
	"policy/profiles": {
		purpose: "Custom policy profiles.",
		safeToDelete: "No. Use policy/config commands.",
	},
	reports: {
		purpose: "Reports, exports, audits, and health output.",
		safeToDelete: "Only after exporting needed reports.",
	},
	"reports/audits": {
		purpose: "Audit reports.",
		safeToDelete: "Only after compliance/support no longer needs them.",
	},
	"reports/exports": {
		purpose: "Data-home exports and user-created report bundles.",
		safeToDelete: "Only after moving needed exports elsewhere.",
	},
	"reports/health": {
		purpose: "Health check reports.",
		safeToDelete: "Usually yes after support/debugging.",
	},
	runtime: {
		purpose: "Runtime session, temp, and lock data.",
		safeToDelete: "No while Browser Control is running.",
	},
	"runtime/sessions": {
		purpose: "Runtime session artifacts.",
		safeToDelete: "Only for completed sessions after evidence is exported.",
	},
	"runtime/temp": {
		purpose: "Temporary runtime files safe for retention-based cleanup.",
		safeToDelete: "Yes via bc data cleanup.",
	},
	"runtime/locks": {
		purpose: "Runtime lock files preventing concurrent unsafe operations.",
		safeToDelete: "No while Browser Control is running.",
	},
	secrets: {
		purpose: "Secret references and protected credential storage metadata.",
		safeToDelete: "No. Use credential/config commands.",
	},
	state: {
		purpose: "Application state databases and persistent registries.",
		safeToDelete: "No. Export first.",
	},
	legacy: {
		purpose: "Legacy non-core data preserved for non-destructive migration.",
		safeToDelete: "Only after manually verifying contents.",
	},
	workflows: {
		purpose: "Workflow definitions, run records, and approvals.",
		safeToDelete: "No. Use workflow commands or export first.",
	},
	"workflows/definitions": {
		purpose: "Workflow graph definitions.",
		safeToDelete: "No. Contains user-created workflows.",
	},
	"workflows/runs": {
		purpose: "Workflow run history.",
		safeToDelete: "Only after exporting needed history.",
	},
	"workflows/approvals": {
		purpose: "Workflow approval records.",
		safeToDelete: "Only if approval history can be reset.",
	},
	skills: {
		purpose: "Installed or generated skill data retained for compatibility.",
		safeToDelete: "Only after confirming no workflows or packages need it.",
	},
	"policy-profiles": {
		purpose: "Legacy policy profile location retained for compatibility.",
		safeToDelete: "Only after migration to policy/profiles is confirmed.",
	},
	profiles: {
		purpose: "Legacy browser profile location retained for compatibility.",
		safeToDelete: "Only after migration to browser/profiles is confirmed.",
	},
	knowledge: {
		purpose: "Local knowledge artifacts used by Browser Control.",
		safeToDelete: "Only after exporting needed knowledge.",
	},
	"knowledge/interaction-skills": {
		purpose: "Interaction knowledge artifacts.",
		safeToDelete: "Only after exporting needed knowledge.",
	},
	"knowledge/domain-skills": {
		purpose: "Domain knowledge artifacts.",
		safeToDelete: "Only after exporting needed knowledge.",
	},
	services: {
		purpose: "Stable local service registry data.",
		safeToDelete: "No. Use service commands.",
	},
	providers: {
		purpose: "Browser provider registry data.",
		safeToDelete: "No. Use provider commands.",
	},
};

const USER_EDITABLE = [
	"automations",
	"workflows/definitions",
	"helpers",
	"packages/installed",
	"reports/exports",
	"config/preferences.json",
];

const PROTECTED_PATHS = [
	"state/app.sqlite",
	"interop",
	"runtime/locks",
	"browser/profiles",
	"policy/audit-log.sqlite",
];

function toSlash(value: string): string {
	return value.replace(/\\/g, "/");
}

function sizeOfPath(target: string): number {
	if (!fs.existsSync(target)) return 0;
	const stat = fs.statSync(target);
	if (stat.isFile()) return stat.size;
	if (!stat.isDirectory()) return 0;
	let total = 0;
	for (const entry of fs.readdirSync(target)) {
		total += sizeOfPath(path.join(target, entry));
	}
	return total;
}

function listFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	const output: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) output.push(...listFiles(fullPath));
		else if (entry.isFile()) output.push(fullPath);
	}
	return output;
}

function getStaleReason(home: string, rel: string, now = new Date()): string | undefined {
	if (rel !== "runtime/temp") return undefined;
	const staleFiles = listFiles(path.join(home, rel)).filter((filePath) => {
		const stat = fs.statSync(filePath);
		const ageHours = (now.getTime() - stat.mtime.getTime()) / 3_600_000;
		return ageHours >= 24;
	});
	return staleFiles.length > 0
		? `${staleFiles.length} temp file(s) older than 24 hours`
		: undefined;
}

function readSchemaVersion(manifestPath: string): number {
	if (!fs.existsSync(manifestPath)) return 0;
	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
			schemaVersion?: unknown;
		};
		return typeof parsed.schemaVersion === "number"
			? parsed.schemaVersion
			: 0;
	} catch {
		return 0;
	}
}

export function inspectDataHome(home = getDataHome()): DataHomeReport {
	ensureDataHomeAtPath(home);
	const manifestPath = getDataHomeManifestPath(home);
	const present: string[] = [];
	const missing: string[] = [];
	const inventory: DataHomeDirectoryInventoryEntry[] = [];
	for (const rel of TARGET_DIRS) {
		const target = path.join(home, rel);
		const exists = fs.existsSync(target);
		if (exists) present.push(rel);
		else missing.push(rel);
		const staleReason = exists ? getStaleReason(home, rel) : undefined;
		const metadata = DIRECTORY_DESCRIPTIONS[rel] ?? {
			purpose: "Browser Control runtime data.",
			safeToDelete: "No. Inspect before deleting.",
		};
		inventory.push({
			path: rel,
			present: exists,
			purpose: metadata.purpose,
			sizeBytes: exists ? sizeOfPath(target) : 0,
			stale: Boolean(staleReason),
			...(staleReason ? { staleReason } : {}),
			safeToDelete: metadata.safeToDelete,
		});
	}

	const legacyAliases: DataHomeLegacyAlias[] = [
		{
			legacy: path.join(home, ".interop"),
			current: getInteropDir(home),
			present: fs.existsSync(path.join(home, ".interop")),
			aliased: fs.existsSync(getInteropDir(home)),
		},
		{
			legacy: path.join(home, "chrome_pid.txt"),
			current: path.join(getInteropDir(home), "chrome.pid"),
			present: fs.existsSync(path.join(home, "chrome_pid.txt")),
			aliased: fs.existsSync(path.join(getInteropDir(home), "chrome.pid")),
		},
		{
			legacy: path.join(home, "screenshots"),
			current: getEvidenceScreenshotsDir(home),
			present: fs.existsSync(path.join(home, "screenshots")),
			aliased: fs.existsSync(getEvidenceScreenshotsDir(home)),
		},
		{
			legacy: path.join(home, "memory.sqlite"),
			current: getMemoryStorePath(home),
			present: fs.existsSync(path.join(home, "memory.sqlite")),
			aliased: fs.existsSync(path.join(home, "memory", "memory.sqlite")),
		},
		{
			legacy: path.join(home, "automation-helpers"),
			current: getHelpersDir(home),
			present: fs.existsSync(path.join(home, "automation-helpers")),
			aliased: fs.existsSync(getAutomationHelpersRegistryPath(home)),
		},
		{
			legacy: path.join(home, "trading"),
			current: path.join(home, "legacy", "trading"),
			present: fs.existsSync(path.join(home, "trading")),
			aliased: fs.existsSync(path.join(home, "legacy", "trading")),
		},
	];

	return {
		home,
		manifestPath,
		schemaVersion: readSchemaVersion(manifestPath) || DATA_HOME_SCHEMA_VERSION,
		sizeBytes: sizeOfPath(home),
		directories: { present, missing, inventory },
		legacyAliases,
		userEditable: USER_EDITABLE.map((rel) => path.join(home, rel)),
		protectedPaths: PROTECTED_PATHS.map((rel) => path.join(home, rel)),
	};
}

export function cleanupDataHome(
	home = getDataHome(),
	options: {
		dryRun?: boolean;
		now?: Date;
		tempTtlHours?: number;
		confirm?: string;
	} = {},
): CleanupResult {
	ensureDataHomeAtPath(home);
	const now = options.now ?? new Date();
	const tempTtlHours = options.tempTtlHours ?? 24;
	const tempDir = getRuntimeTempDir(home);
	const candidates: CleanupCandidate[] = [];

	for (const filePath of listFiles(tempDir)) {
		const stat = fs.statSync(filePath);
		const ageHours = (now.getTime() - stat.mtime.getTime()) / 3_600_000;
		if (ageHours >= tempTtlHours) {
			candidates.push({
				path: filePath,
				reason: `runtime temp older than ${tempTtlHours} hours`,
				sizeBytes: stat.size,
				ageHours,
			});
		}
	}

	// Default is always dry-run (true). Deletion only happens when dryRun is false AND confirmation is provided.
	const isDryRunRequested = options.dryRun === false;
	const isConfirmed = options.confirm === "DELETE_RUNTIME_TEMP";
	const isDryRun = !isDryRunRequested || !isConfirmed;

	const deleted: string[] = [];
	let reclaimedBytes = 0;
	if (!isDryRun) {
		for (const candidate of candidates) {
			fs.rmSync(candidate.path, { force: true });
			deleted.push(candidate.path);
			reclaimedBytes += candidate.sizeBytes;
		}
	}

	return {
		dryRun: isDryRun,
		candidates,
		deleted,
		reclaimedBytes,
	};
}

function safeCopyIfExists(home: string, exportDir: string, rel: string): number {
	const source = path.join(home, rel);
	if (!fs.existsSync(source)) return 0;
	const target = path.join(exportDir, rel);
	const sourceStat = fs.statSync(source);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	if (sourceStat.isDirectory()) {
		fs.cpSync(source, target, { recursive: true, force: false });
		return listFiles(source).length;
	}
	fs.copyFileSync(source, target);
	return 1;
}

export function exportDataHome(
	home = getDataHome(),
	options: { label?: string; now?: Date } = {},
): DataExportResult {
	ensureDataHomeAtPath(home);
	const now = options.now ?? new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const label = (options.label ?? "export")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const exportDir = path.join(home, "reports", "exports", `${stamp}-${label || "export"}`);
	fs.mkdirSync(exportDir, { recursive: true, mode: 0o700 });

	let filesCopied = 0;
	for (const rel of [
		"manifest.json",
		"config/config.json",
		"config/preferences.json",
		"automations",
		"workflows/definitions",
		"helpers/registry.json",
		"packages/registry.json",
		"legacy/trading/journals",
	]) {
		filesCopied += safeCopyIfExists(home, exportDir, rel);
	}

	const manifest = {
		product: "browser-control",
		exportedAt: now.toISOString(),
		sourceHome: home,
		schemaVersion: readSchemaVersion(getDataHomeManifestPath(home)),
		filesCopied,
		redaction: "Secrets directory and runtime state are not exported.",
	};
	const manifestPath = path.join(exportDir, "manifest.json");
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});

	return {
		success: true,
		exportDir,
		manifestPath,
		filesCopied,
	};
}

export function formatDataHomeReport(report: DataHomeReport): string {
	return [
		`Data home: ${report.home}`,
		`Schema: ${report.schemaVersion}`,
		`Size: ${report.sizeBytes} bytes`,
		`Missing dirs: ${report.directories.missing.length}`,
		`Folders: ${report.directories.inventory.length}`,
		`Stale folders: ${report.directories.inventory
			.filter((entry) => entry.stale)
			.map((entry) => `${entry.path} (${entry.staleReason})`)
			.join(", ") || "none"}`,
		`Legacy aliases: ${report.legacyAliases
			.filter((entry) => entry.present)
			.map((entry) => `${toSlash(entry.legacy)} -> ${toSlash(entry.current)}`)
			.join(", ") || "none"}`,
	].join("\n");
}
