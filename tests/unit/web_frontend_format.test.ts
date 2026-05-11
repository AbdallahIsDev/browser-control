import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	formatCellValue,
	formatDateTime,
	formatTerminalActionResult,
} from "../../src/shared/format";

test("frontend date helper renders ISO timestamps as local human-readable values", () => {
	const rendered = formatDateTime("2026-05-07T14:56:41.113Z");

	assert.match(rendered, /2026/);
	assert.doesNotMatch(rendered, /T14:56:41\.113Z/);
	assert.doesNotMatch(rendered, /Invalid Date/);
	assert.match(rendered, /\b(UTC|GMT|[A-Z]{2,5})/);
});

test("frontend table formatting keeps invalid and missing dates graceful", () => {
	assert.equal(formatDateTime("not-a-date"), "Unknown time");
	assert.equal(formatDateTime(null), "Unknown time");
	assert.equal(
		formatCellValue("2026-05-07T14:56:41.113Z", "timestamp"),
		formatDateTime("2026-05-07T14:56:41.113Z"),
	);
	assert.equal(
		formatCellValue("browser-control", "runtime"),
		"browser-control",
	);
});

test("terminal summary hides raw JSON from primary output", () => {
	const summary = formatTerminalActionResult({
		success: true,
		data: {
			stdout: "v22.1.0\n",
			stderr: "",
			exitCode: 0,
			durationMs: 12,
			cwd: "C:\\repo",
		},
	});

	assert.match(summary, /stdout/);
	assert.match(summary, /v22\.1\.0/);
	assert.match(summary, /exit code: 0/i);
	assert.doesNotMatch(summary, /"stdout"/);
	assert.doesNotMatch(summary, /raw/i);
});

test("frontend exposes premium primary product views", () => {
	const appSource = fs.readFileSync(
		path.resolve(__dirname, "../../web/src/App.tsx"),
		"utf8",
	);

	for (const label of [
		"Command",
		"Tasks",
		"Automations",
		"Browser",
		"Trading",
		"Workflows",
		"Packages",
		"Evidence",
		"Settings",
		"Advanced",
	]) {
		assert.match(
			appSource,
			new RegExp(`label: "${label}"`),
			`${label} view missing`,
		);
	}
});
