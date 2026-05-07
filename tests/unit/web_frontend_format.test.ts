import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const format = require(path.resolve(__dirname, "../../web/src/format.js")) as {
	formatDateTime: (value: unknown) => string;
	formatCellValue: (value: unknown, key?: string) => string;
	formatTerminalActionResult: (value: unknown, fallback?: string) => string;
};

test("frontend date helper renders ISO timestamps as local human-readable values", () => {
	const rendered = format.formatDateTime("2026-05-07T14:56:41.113Z");

	assert.match(rendered, /2026/);
	assert.doesNotMatch(rendered, /T14:56:41\.113Z/);
	assert.doesNotMatch(rendered, /Invalid Date/);
	assert.match(rendered, /\b(UTC|GMT|[A-Z]{2,5})/);
});

test("frontend table formatting keeps invalid and missing dates graceful", () => {
	assert.equal(format.formatDateTime("not-a-date"), "Unknown time");
	assert.equal(format.formatDateTime(null), "Unknown time");
	assert.equal(
		format.formatCellValue("2026-05-07T14:56:41.113Z", "timestamp"),
		format.formatDateTime("2026-05-07T14:56:41.113Z"),
	);
	assert.equal(
		format.formatCellValue("browser-control", "runtime"),
		"browser-control",
	);
});

test("terminal summary hides raw JSON from primary output", () => {
	const summary = format.formatTerminalActionResult({
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
