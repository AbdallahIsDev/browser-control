import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	cleanupDataHome,
	exportDataHome,
	inspectDataHome,
} from "../../src/data_home";
import {
	ensureDataHomeAtPath,
	getDataHomeManifestPath,
	getEvidenceScreenshotsDir,
	getHelpersDir,
	getInteropDir,
	getRuntimeTempDir,
} from "../../src/shared/paths";

test("data home v2 creates manifest, target dirs, and non-destructive legacy aliases", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-home-"));
	try {
		fs.mkdirSync(path.join(home, ".interop"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".interop", "chrome-debug.json"),
			JSON.stringify({ port: 9222 }),
		);
		fs.writeFileSync(path.join(home, "chrome_pid.txt"), "1234\n");
		fs.mkdirSync(path.join(home, "screenshots"), { recursive: true });
		fs.writeFileSync(path.join(home, "screenshots", "old.png"), "png");
		fs.mkdirSync(path.join(home, "automation-helpers"), { recursive: true });
		fs.writeFileSync(
			path.join(home, "automation-helpers", "registry.json"),
			"[]\n",
		);
		fs.writeFileSync(path.join(home, "memory.sqlite"), "sqlite");

		ensureDataHomeAtPath(home);

		const manifest = JSON.parse(
			fs.readFileSync(getDataHomeManifestPath(home), "utf8"),
		);
		assert.equal(manifest.schemaVersion, 2);
		assert.equal(manifest.product, "browser-control");
		assert.equal(fs.existsSync(getInteropDir(home)), true);
		assert.equal(
			fs.existsSync(path.join(getInteropDir(home), "chrome-debug.json")),
			true,
		);
		assert.equal(fs.existsSync(path.join(getInteropDir(home), "chrome.pid")), true);
		assert.equal(fs.existsSync(getEvidenceScreenshotsDir(home)), true);
		assert.equal(
			fs.existsSync(path.join(getEvidenceScreenshotsDir(home), "old.png")),
			true,
		);
		assert.equal(fs.existsSync(getHelpersDir(home)), true);
		assert.equal(
			fs.existsSync(path.join(getHelpersDir(home), "registry.json")),
			true,
		);
		assert.equal(fs.existsSync(path.join(home, "memory", "memory.sqlite")), true);

		assert.equal(
			fs.existsSync(path.join(home, ".interop", "chrome-debug.json")),
			true,
			"legacy files are preserved",
		);
		assert.equal(
			fs.existsSync(path.join(home, "automation-helpers", "registry.json")),
			true,
			"legacy helper registry is preserved",
		);

		const report = inspectDataHome(home);
		assert.equal(report.schemaVersion, 2);
		assert.equal(report.directories.missing.length, 0);
		assert.ok(
			report.legacyAliases.some((entry) => entry.legacy.endsWith(".interop")),
		);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("data cleanup dry run only targets retention-safe temp files", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-cleanup-"));
	try {
		ensureDataHomeAtPath(home);
		const tempDir = getRuntimeTempDir(home);
		const staleTemp = path.join(tempDir, "old.tmp");
		fs.writeFileSync(staleTemp, "old");
		const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
		fs.utimesSync(staleTemp, oldTime, oldTime);

		const journal = path.join(home, "trading", "journals", "keep.md");
		fs.mkdirSync(path.dirname(journal), { recursive: true });
		fs.writeFileSync(journal, "never delete");
		fs.utimesSync(journal, oldTime, oldTime);

		const result = cleanupDataHome(home, { dryRun: true, now: new Date() });
		assert.equal(result.dryRun, true);
		assert.ok(result.candidates.some((entry) => entry.path === staleTemp));
		assert.equal(
			result.candidates.some((entry) => entry.path === journal),
			false,
			"trading journals are never auto-cleaned",
		);
		assert.equal(fs.existsSync(staleTemp), true, "dry run does not delete");
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("data export writes a portable manifest under reports exports", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-export-"));
	try {
		ensureDataHomeAtPath(home);
		fs.writeFileSync(
			path.join(home, "config", "preferences.json"),
			JSON.stringify({ theme: "dark" }),
		);

		const result = exportDataHome(home, { label: "unit" });
		assert.equal(result.success, true);
		assert.ok(result.exportDir.includes(path.join("reports", "exports")));
		assert.equal(fs.existsSync(path.join(result.exportDir, "manifest.json")), true);
		assert.equal(
			fs.existsSync(path.join(result.exportDir, "config", "preferences.json")),
			true,
		);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
