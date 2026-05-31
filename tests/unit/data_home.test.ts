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
	ensureDataHome,
	getDataHome,
	getDataHomeManifestPath,
	getEvidenceScreenshotsDir,
	getStructuredSessionRuntimeDir,
	getHelpersDir,
	getInteropDir,
	getRuntimeTempDir,
} from "../../src/shared/paths";

// ── Data Home Safety Guard Tests ─────────────────────────────────────

test("getDataHome rejects BROWSER_CONTROL_HOME=os.homedir()", () => {
	const previous = process.env.BROWSER_CONTROL_HOME;
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	process.env.BROWSER_CONTROL_HOME = os.homedir();
	try {
		assert.throws(
			() => getDataHome(),
			/Refusing unsafe Browser Control data home/,
			"should reject homedir as data home",
		);
	} finally {
		if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previous;
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

test("getDataHome rejects BROWSER_CONTROL_HOME=C:\\ (drive root)", () => {
	const previous = process.env.BROWSER_CONTROL_HOME;
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	process.env.BROWSER_CONTROL_HOME = "C:\\";
	try {
		assert.throws(
			() => getDataHome(),
			/Refusing unsafe Browser Control data home/,
			"should reject drive root as data home",
		);
	} finally {
		if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previous;
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

test("ensureDataHomeAtPath(os.homedir()) rejects", () => {
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	try {
		assert.throws(
			() => ensureDataHomeAtPath(os.homedir()),
			/Refusing unsafe Browser Control data home/,
			"should reject homedir as ensureDataHomeAtPath argument",
		);
	} finally {
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

for (const folder of ["Desktop", "Documents", "Downloads"]) {
	test(`getDataHome rejects BROWSER_CONTROL_HOME=~/${folder}`, () => {
		const previous = process.env.BROWSER_CONTROL_HOME;
		const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		const unsafePath = path.join(os.homedir(), folder);
		process.env.BROWSER_CONTROL_HOME = unsafePath;
		try {
			assert.throws(
				() => getDataHome(),
				/Refusing unsafe Browser Control data home/,
				`should reject ${folder} as data home`,
			);
		} finally {
			if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
			else process.env.BROWSER_CONTROL_HOME = previous;
			if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
			else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
		}
	});

	test(`ensureDataHomeAtPath rejects ~/${folder} before creating Browser Control folders`, () => {
		const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		const unsafePath = path.join(os.homedir(), folder);
		try {
			assert.throws(
				() => ensureDataHomeAtPath(unsafePath),
				/Refusing unsafe Browser Control data home/,
				`should reject ${folder} as explicit data home`,
			);
			assert.equal(
				fs.existsSync(path.join(unsafePath, "manifest.json")),
				false,
				"manifest.json should not be created in visible user folders",
			);
			assert.equal(
				fs.existsSync(path.join(unsafePath, "runtime")),
				false,
				"runtime dir should not be created in visible user folders",
			);
		} finally {
			if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
			else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
		}
	});
}

test("getDataHome default returns ~/.browser-control (not home root)", () => {
	const previous = process.env.BROWSER_CONTROL_HOME;
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_HOME;
	try {
		const result = getDataHome();
		assert.ok(result.endsWith(".browser-control"), `default should end with .browser-control, got: ${result}`);
		assert.notEqual(result, os.homedir(), "default should not equal homedir");
	} finally {
		if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previous;
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

test("temp data homes under $TEMP are allowed", () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-safe-test-"));
	const previous = process.env.BROWSER_CONTROL_HOME;
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpDir;
	try {
		const result = getDataHome();
		assert.equal(result, path.resolve(tmpDir), "temp data home should be allowed");
	} finally {
		if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previous;
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

test("BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME=1 allows unsafe home", () => {
	const previous = process.env.BROWSER_CONTROL_HOME;
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = "1";
	process.env.BROWSER_CONTROL_HOME = os.homedir();
	try {
		const result = getDataHome();
		assert.equal(result, path.resolve(os.homedir()), "env override should allow unsafe home");
	} finally {
		if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previous;
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

test("unsafe home does not create any root-level BC folders on guard rejection", () => {
	const previous = process.env.BROWSER_CONTROL_HOME;
	const prevAllow = process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
	process.env.BROWSER_CONTROL_HOME = os.homedir();
	try {
		assert.throws(() => ensureDataHome(), /Refusing unsafe/);
		// Verify no manifest.json, state, memory, browser, reports were created
		const home = os.homedir();
		assert.equal(fs.existsSync(path.join(home, "manifest.json")), false,
			"manifest.json should not be created at home root after rejection");
		assert.equal(fs.existsSync(path.join(home, "state")), false,
			"state dir should not be created at home root after rejection");
		assert.equal(fs.existsSync(path.join(home, "memory")), false,
			"memory dir should not be created at home root after rejection");
		assert.equal(fs.existsSync(path.join(home, "browser")), false,
			"browser dir should not be created at home root after rejection");
		assert.equal(fs.existsSync(path.join(home, "reports")), false,
			"reports dir should not be created at home root after rejection");
	} finally {
		if (previous === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previous;
		if (prevAllow === undefined) delete process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME;
		else process.env.BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME = prevAllow;
	}
});

test("fresh data home init creates only essential root directories", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-home-minimal-"));
	try {
		ensureDataHomeAtPath(home);
		const dirs = fs
			.readdirSync(home, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();

		assert.deepEqual(dirs, ["config", "interop", "runtime", "secrets", "state"]);
		assert.equal(fs.existsSync(path.join(home, "manifest.json")), true);
		assert.equal(fs.existsSync(path.join(home, "README.md")), true);
		assert.equal(fs.existsSync(path.join(home, "legacy")), false);
		assert.equal(fs.existsSync(path.join(home, ".interop")), false);
		assert.equal(fs.existsSync(path.join(home, "runtime", "temp")), false);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("secrets README documents vault key exposure boundary", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-home-secrets-readme-"));
	try {
		ensureDataHomeAtPath(home);
		const readme = fs.readFileSync(path.join(home, "secrets", "README.md"), "utf8");

		assert.match(readme, /\.vault-key/);
		assert.match(readme, /decryption key/);
		assert.match(readme, /Never commit, sync, or back up/);
		assert.match(readme, /Windows/);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("structured session runtime dir is stable outside created-at date folders", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-runtime-path-"));
	try {
		const runtimeDir = getStructuredSessionRuntimeDir(
			{
				id: "a370f357-1111-2222-3333-444444444444",
				name: "Stdio Session Test",
				createdAt: "2026-05-23T23:07:00.000Z",
			},
			home,
		);

		assert.equal(
			runtimeDir,
			path.join(home, "runtime", "stdio-session-test_a370f357"),
		);
		assert.equal(runtimeDir.includes("2026-05-23"), false);
		assert.equal(path.basename(runtimeDir).startsWith("23-07_"), false);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("data home v2 creates manifest, essential dirs, and non-destructive legacy aliases", () => {
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
		const readmePath = path.join(home, "README.md");
		assert.equal(fs.existsSync(readmePath), true);
		const readme = fs.readFileSync(readmePath, "utf8");
		assert.match(readme, /Browser Control Data Home/);
		assert.match(readme, /created lazily/);
		assert.match(readme, /runtime\/temp/);
		assert.match(readme, /Do not delete/);
		for (const rel of ["config", "runtime", "state", "secrets", "interop"]) {
			assert.equal(fs.existsSync(path.join(home, rel)), true, `${rel} should be created on init`);
		}
		for (const rel of [
			"automations",
			"backups",
			"browser/profiles",
			"observability/screencasts",
			"observability/receipts",
			"helpers/quarantine",
			"legacy",
			"reports/audits",
			"runtime/temp",
			"workflows/approvals",
			".interop/new-install",
			"profiles/new-install",
		]) {
			assert.equal(fs.existsSync(path.join(home, rel)), false, `${rel} should be lazy`);
		}
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
			report.directories.inventory.some((entry) =>
				entry.path === "runtime/temp" && entry.present === false
			),
			"optional lazy directories should stay in inventory without counting as missing",
		);
		assert.ok(
			report.directories.inventory.some((entry) =>
				entry.path === "observability/screencasts" && entry.present === false
			),
			"screencast inventory should point at the recorder output location",
		);
		assert.equal(
			report.directories.inventory.some((entry) => entry.path === "evidence/screencasts"),
			false,
			"dead evidence/screencasts inventory entry should not be advertised",
		);
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
		fs.mkdirSync(tempDir, { recursive: true });
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

test("data cleanup stale dry run reports top-level trading without moving user data", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-stale-dry-"));
	try {
		ensureDataHomeAtPath(home);
		const journal = path.join(home, "trading", "journals", "keep.md");
		fs.mkdirSync(path.dirname(journal), { recursive: true });
		fs.writeFileSync(journal, "keep");

		const result = cleanupDataHome(home, { dryRun: true, includeStaleLegacy: true });

		assert.equal(result.dryRun, true);
		assert.ok(result.candidates.some((entry) => entry.path === path.join(home, "trading")));
		assert.equal(fs.existsSync(journal), true);
		assert.equal(fs.existsSync(path.join(home, "legacy", "trading", "journals", "keep.md")), false);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("data cleanup stale moves top-level trading to legacy with explicit confirmation", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-stale-move-"));
	try {
		ensureDataHomeAtPath(home);
		const journal = path.join(home, "trading", "journals", "keep.md");
		fs.mkdirSync(path.dirname(journal), { recursive: true });
		fs.writeFileSync(journal, "keep");

		const result = cleanupDataHome(home, {
			dryRun: false,
			confirm: "MOVE_STALE_LEGACY",
			includeStaleLegacy: true,
		});

		assert.equal(result.dryRun, false);
		assert.equal(fs.existsSync(path.join(home, "trading")), false);
		const movedJournal = path.join(home, "legacy", "trading", "journals", "keep.md");
		assert.equal(fs.existsSync(movedJournal), true);
		assert.equal(fs.readFileSync(movedJournal, "utf8"), "keep");
		assert.ok(result.moved.some((entry) => entry.from === path.join(home, "trading")));
		assert.equal(result.deleted.length, 0);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("data home report classifies trading as legacy non-core when present", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-legacy-"));
	try {
		ensureDataHomeAtPath(home);
		fs.mkdirSync(path.join(home, "trading", "journals"), { recursive: true });
		fs.writeFileSync(path.join(home, "trading", "journals", "keep.md"), "keep");

		const report = inspectDataHome(home);

		assert.ok(
			report.legacyAliases.some((entry) =>
				entry.legacy.endsWith(`${path.sep}trading`) &&
				entry.present === true &&
				entry.current.endsWith(path.join("legacy", "trading")),
			),
			"trading directory should be reported as legacy/non-core, not product surface",
		);
		assert.equal(
			report.userEditable.some((entry) => entry.includes(`${path.sep}trading${path.sep}`)),
			false,
			"trading should not be listed as a normal user-editable product folder",
		);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("data home report includes folder purpose, size, and staleness inventory", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-data-inventory-"));
	try {
		ensureDataHomeAtPath(home);
		const staleTemp = path.join(getRuntimeTempDir(home), "stale.tmp");
		fs.mkdirSync(path.dirname(staleTemp), { recursive: true });
		fs.writeFileSync(staleTemp, "stale-temp");
		const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
		fs.utimesSync(staleTemp, oldTime, oldTime);

		const report = inspectDataHome(home);
		const inventory = report.directories.inventory;
		assert.ok(Array.isArray(inventory));
		const runtimeTemp = inventory.find((entry) => entry.path === "runtime/temp");
		assert.ok(runtimeTemp, "runtime/temp should be inventoried");
		assert.equal(runtimeTemp.present, true);
		assert.match(runtimeTemp.purpose, /temporary/i);
		assert.ok(runtimeTemp.sizeBytes >= Buffer.byteLength("stale-temp"));
		assert.equal(runtimeTemp.stale, true);
		assert.match(runtimeTemp.staleReason ?? "", /older than 24 hours/);

		const profiles = inventory.find((entry) => entry.path === "browser/profiles");
		assert.ok(profiles, "browser/profiles should be inventoried");
		assert.match(profiles.purpose, /browser profiles/i);
		assert.equal(profiles.stale, false);
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
