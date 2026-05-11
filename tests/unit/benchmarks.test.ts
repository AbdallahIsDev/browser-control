import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	compareBenchmarkRuns,
	listBenchmarkRuns,
	runBenchmarks,
} from "../../src/benchmarks/runner";

test("benchmark runner records real task metrics and stores historical results", async () => {
	const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-bench-"));
	try {
		const run = await runBenchmarks({
			dataHome,
			suite: "terminal",
			iterations: 2,
			tasks: [
				{
					name: "mock terminal exec",
					suite: "terminal",
					path: "command",
					run: async () => ({
						success: true,
						retries: 0,
						policyDecisions: 1,
					}),
				},
			],
		});

		assert.equal(run.summary.suite, "terminal");
		assert.equal(run.summary.totalBenchmarks, 2);
		assert.equal(run.summary.passed, 2);
		assert.equal(run.summary.successRate, 1);
		assert.equal(run.summary.pathBreakdown.command, 2);
		assert.equal(fs.existsSync(run.savedPath), true);

		const runs = listBenchmarkRuns(dataHome, { last: 1 });
		assert.equal(runs.length, 1);
		assert.equal(runs[0].runId, run.runId);
	} finally {
		fs.rmSync(dataHome, { recursive: true, force: true });
	}
});

test("benchmark comparison reports pass-rate and latency deltas", async () => {
	const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-bench-compare-"));
	try {
		const slow = await runBenchmarks({
			dataHome,
			suite: "terminal",
			tasks: [
				{
					name: "slow",
					suite: "terminal",
					path: "command",
					run: async () => {
						await new Promise((resolve) => setTimeout(resolve, 5));
						return { success: true };
					},
				},
			],
		});
		const fast = await runBenchmarks({
			dataHome,
			suite: "terminal",
			tasks: [
				{
					name: "fast",
					suite: "terminal",
					path: "command",
					run: async () => ({ success: true }),
				},
			],
		});

		const comparison = compareBenchmarkRuns(dataHome, slow.runId, fast.runId);
		assert.equal(comparison.baseRunId, slow.runId);
		assert.equal(comparison.compareRunId, fast.runId);
		assert.equal(comparison.successRateDelta, 0);
		assert.ok(Number.isFinite(comparison.avgDurationDeltaMs));
	} finally {
		fs.rmSync(dataHome, { recursive: true, force: true });
	}
});
