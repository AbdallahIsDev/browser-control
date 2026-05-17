import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import {
	buildReplayView,
	computeDomDiff,
	computePixelDiff,
	filterAuditEntries,
} from "../../src/observability/visual_diff";

function writePng(filePath: string, pixels: Array<[number, number, number, number]>): void {
	const png = new PNG({ width: 2, height: 1 });
	pixels.forEach((pixel, index) => {
		const offset = index << 2;
		png.data[offset] = pixel[0];
		png.data[offset + 1] = pixel[1];
		png.data[offset + 2] = pixel[2];
		png.data[offset + 3] = pixel[3];
	});
	fs.writeFileSync(filePath, PNG.sync.write(png));
}

test("computePixelDiff compares PNG pixels and stores diff artifact under data home", () => {
	const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-visual-diff-"));
	const previousHome = process.env.BROWSER_CONTROL_HOME;
	process.env.BROWSER_CONTROL_HOME = tmpHome;
	try {
		const before = path.join(tmpHome, "before.png");
		const after = path.join(tmpHome, "after.png");
		writePng(before, [
			[0, 0, 0, 255],
			[255, 255, 255, 255],
		]);
		writePng(after, [
			[0, 0, 0, 255],
			[255, 0, 0, 255],
		]);

		const result = computePixelDiff(before, after);
		assert.ok(result);
		assert.equal(result.width, 2);
		assert.equal(result.height, 1);
		assert.equal(result.changedPixelCount, 1);
		assert.equal(result.totalPixels, 2);
		assert.equal(result.changeRatio, 0.5);
		assert.equal(result.changedPercent, 50);
		assert.ok(result.diffPath);
		assert.ok(result.diffPath.startsWith(path.join(tmpHome, "reports", "evidence")));
		assert.ok(fs.existsSync(result.diffPath));
	} finally {
		if (previousHome === undefined) delete process.env.BROWSER_CONTROL_HOME;
		else process.env.BROWSER_CONTROL_HOME = previousHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
});

test("computeDomDiff and replay view redact secrets from evidence", () => {
	const dom = computeDomDiff(
		[{ selector: "#password", text: "Order count 1" }],
		[{ selector: "#password", name: "secret://login/password", text: "Order count 2 secret://login/password" }],
	);
	assert.equal(dom.elementsChanged, 1);
	assert.equal(dom.changedNodes[0]?.name, "[REDACTED]");
	assert.doesNotMatch(JSON.stringify(dom), /newSecret1234|secret:\/\/login/u);

	const replay = buildReplayView({
		id: "run-1",
		status: "failed",
		startedAt: "2026-05-15T00:00:00.000Z",
		completedAt: "2026-05-15T00:00:01.000Z",
		nodeResults: {
			"node-1": {
				kind: "browser",
				input: { value: "secret://login/password" },
				output: { authorization: "Bearer abcdefghijklmnop" },
				error: "password=newSecret1234",
				startedAt: "2026-05-15T00:00:00.000Z",
				completedAt: "2026-05-15T00:00:01.000Z",
			},
		},
	});
	assert.doesNotMatch(JSON.stringify(replay), /secret:\/\/login|abcdefghijklmnop|newSecret1234/u);
});

test("filterAuditEntries applies filters and redacts details", () => {
	const entries = filterAuditEntries(
		[
			{
				id: "1",
				action: "workflow_run",
				sessionId: "s1",
				risk: "high",
				policyDecision: "allow_with_audit",
				details: "workflow=wf-1 package=pkg-a token=superSecretToken12345",
				timestamp: "2026-05-15T00:00:00.000Z",
			},
			{
				id: "2",
				action: "package_run",
				sessionId: "s2",
				risk: "low",
				details: "package=pkg-b",
				timestamp: "2026-05-15T00:00:01.000Z",
			},
		],
		{ sessionId: "s1", workflowId: "wf-1", packageName: "pkg-a", risk: "high" },
	);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.id, "1");
	assert.doesNotMatch(entries[0]?.details ?? "", /superSecretToken12345/u);
});
