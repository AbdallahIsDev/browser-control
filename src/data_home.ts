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
	"browser/profiles",
	"browser/downloads",
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
	"packages",
	"packages/installed",
	"packages/evals",
	"policy",
	"policy/approvals",
	"policy/profiles",
	"reports",
	"reports/audits",
	"reports/exports",
	"reports/health",
	"runtime/sessions",
	"runtime/temp",
	"runtime/locks",
	"secrets",
	"state",
	"trading/journals",
	"trading/trade-plans",
	"trading/orders",
	"trading/positions",
	"trading/supervisor-jobs",
	"trading/risk-snapshots",
	"trading/evidence",
	"workflows/definitions",
	"workflows/runs",
	"workflows/approvals",
];

const USER_EDITABLE = [
	"automations",
	"workflows/definitions",
	"helpers",
	"packages/installed",
	"trading/journals",
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
	for (const rel of TARGET_DIRS) {
		const target = path.join(home, rel);
		if (fs.existsSync(target)) present.push(rel);
		else missing.push(rel);
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
	];

	return {
		home,
		manifestPath,
		schemaVersion: readSchemaVersion(manifestPath) || DATA_HOME_SCHEMA_VERSION,
		sizeBytes: sizeOfPath(home),
		directories: { present, missing },
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
		"trading/journals",
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
		`Legacy aliases: ${report.legacyAliases
			.filter((entry) => entry.present)
			.map((entry) => `${toSlash(entry.legacy)} -> ${toSlash(entry.current)}`)
			.join(", ") || "none"}`,
	].join("\n");
}
