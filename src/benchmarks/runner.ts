import fs from "node:fs";
import path from "node:path";
import type { BrowserControlAPI } from "../browser_control";
import { ensureDataHomeAtPath, getDataHome } from "../shared/paths";
import type {
	BenchmarkComparison,
	BenchmarkResult,
	BenchmarkRunOutput,
	BenchmarkRunRecord,
	BenchmarkSuiteName,
	BenchmarkSuiteResult,
	BenchmarkTask,
} from "./types";

export type {
	BenchmarkComparison,
	BenchmarkResult,
	BenchmarkRunOutput,
	BenchmarkRunRecord,
	BenchmarkSuiteName,
	BenchmarkSuiteResult,
	BenchmarkTask,
} from "./types";

export interface RunBenchmarkOptions {
	dataHome?: string;
	suite?: BenchmarkSuiteName;
	iterations?: number;
	tasks?: BenchmarkTask[];
	api?: BrowserControlAPI;
}

export interface ListBenchmarkOptions {
	last?: number;
}

function benchmarksDir(dataHome: string): string {
	return path.join(dataHome, "benchmarks");
}

function benchmarkPath(dataHome: string, runId: string): string {
	return path.join(benchmarksDir(dataHome), `${runId}.json`);
}

function runIdFromDate(date: Date): string {
	return `bench-${date.toISOString().replace(/[:.]/g, "-")}`;
}

function summarize(
	suite: string,
	results: BenchmarkResult[],
	timestamp: string,
): BenchmarkSuiteResult {
	const total = results.length;
	const passed = results.filter((result) => result.success).length;
	const failed = total - passed;
	const avgDurationMs =
		total === 0
			? 0
			: results.reduce((sum, result) => sum + result.durationMs, 0) / total;
	return {
		suite,
		totalBenchmarks: total,
		passed,
		failed,
		successRate: total === 0 ? 0 : passed / total,
		avgDurationMs,
		pathBreakdown: {
			command: results.filter((result) => result.executionPath === "command").length,
			a11y: results.filter((result) => result.executionPath === "a11y").length,
			lowLevel: results.filter((result) => result.executionPath === "low_level").length,
		},
		timestamp,
	};
}

function selectTasks(tasks: BenchmarkTask[], suite: BenchmarkSuiteName): BenchmarkTask[] {
	if (suite === "all") return tasks;
	return tasks.filter((task) => task.suite === suite);
}

async function measureTask(task: BenchmarkTask): Promise<BenchmarkResult> {
	const started = performance.now();
	const timestamp = new Date().toISOString();
	try {
		const result = await task.run();
		return {
			name: task.name,
			suite: task.suite,
			success: result.success,
			durationMs: performance.now() - started,
			retries: result.retries ?? 0,
			executionPath: task.path,
			policyDecisions: result.policyDecisions ?? 0,
			...(result.error ? { error: result.error } : {}),
			timestamp,
		};
	} catch (error) {
		return {
			name: task.name,
			suite: task.suite,
			success: false,
			durationMs: performance.now() - started,
			retries: 0,
			executionPath: task.path,
			policyDecisions: 0,
			error: error instanceof Error ? error.message : String(error),
			timestamp,
		};
	}
}

export function createDefaultBenchmarkTasks(api: BrowserControlAPI): BenchmarkTask[] {
	return [
		{
			name: "terminal exec node version",
			suite: "terminal",
			path: "command",
			run: async () => {
				const result = await api.terminal.exec({
					command: "node --version",
					timeoutMs: 15_000,
				});
				return {
					success: result.success,
					policyDecisions: result.policyDecision ? 1 : 0,
					error: result.error,
				};
			},
		},
		{
			name: "filesystem list workspace",
			suite: "filesystem",
			path: "command",
			run: async () => {
				const result = await api.fs.ls({ path: ".", recursive: false });
				return {
					success: result.success,
					policyDecisions: result.policyDecision ? 1 : 0,
					error: result.error,
				};
			},
		},
		{
			name: "browser snapshot active page",
			suite: "browser",
			path: "a11y",
			run: async () => {
				const result = await api.browser.snapshot();
				return {
					success: result.success,
					policyDecisions: result.policyDecision ? 1 : 0,
					error: result.error,
				};
			},
		},
		{
			name: "combined terminal and filesystem",
			suite: "combined",
			path: "command",
			run: async () => {
				const term = await api.terminal.exec({
					command: "node --version",
					timeoutMs: 15_000,
				});
				if (!term.success) return { success: false, error: term.error };
				const list = await api.fs.ls({ path: ".", recursive: false });
				return {
					success: list.success,
					policyDecisions:
						(term.policyDecision ? 1 : 0) + (list.policyDecision ? 1 : 0),
					error: list.error,
				};
			},
		},
	];
}

export async function runBenchmarks(
	options: RunBenchmarkOptions = {},
): Promise<BenchmarkRunOutput> {
	const dataHome = ensureDataHomeAtPath(options.dataHome ?? getDataHome());
	const suite = options.suite ?? "all";
	const iterations = Math.max(1, Math.floor(options.iterations ?? 1));
	let ownsApi = false;
	let api = options.api;
	if (!options.tasks && !api) {
		const { createBrowserControl } = await import("../browser_control");
		api = createBrowserControl({ dataHome });
		ownsApi = true;
	}
	const tasks = options.tasks ?? createDefaultBenchmarkTasks(api as BrowserControlAPI);
	const selected = selectTasks(tasks, suite);
	const started = new Date();
	const results: BenchmarkResult[] = [];

	try {
		for (let iteration = 0; iteration < iterations; iteration += 1) {
			for (const task of selected) {
				results.push(await measureTask(task));
			}
		}
	} finally {
		if (ownsApi) api?.close();
	}

	const completed = new Date();
	const runId = runIdFromDate(started);
	const summary = summarize(suite, results, completed.toISOString());
	const record: BenchmarkRunRecord = {
		runId,
		suite,
		startedAt: started.toISOString(),
		completedAt: completed.toISOString(),
		iterations,
		results,
		summary,
	};
	const dir = benchmarksDir(dataHome);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const savedPath = benchmarkPath(dataHome, runId);
	fs.writeFileSync(savedPath, `${JSON.stringify(record, null, 2)}\n`, {
		mode: 0o600,
	});
	return { ...record, savedPath };
}

export function listBenchmarkRuns(
	dataHome = getDataHome(),
	options: ListBenchmarkOptions = {},
): BenchmarkRunRecord[] {
	const dir = benchmarksDir(dataHome);
	if (!fs.existsSync(dir)) return [];
	const records = fs
		.readdirSync(dir)
		.filter((file) => file.endsWith(".json"))
		.map((file) => path.join(dir, file))
		.map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as BenchmarkRunRecord)
		.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
	return typeof options.last === "number" ? records.slice(0, options.last) : records;
}

function loadBenchmarkRun(dataHome: string, runId: string): BenchmarkRunRecord {
	const filePath = benchmarkPath(dataHome, runId);
	if (!fs.existsSync(filePath)) throw new Error(`Benchmark run not found: ${runId}`);
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as BenchmarkRunRecord;
}

export function compareBenchmarkRuns(
	dataHome: string,
	baseRunId: string,
	compareRunId: string,
): BenchmarkComparison {
	const base = loadBenchmarkRun(dataHome, baseRunId);
	const compare = loadBenchmarkRun(dataHome, compareRunId);
	return {
		baseRunId,
		compareRunId,
		successRateDelta: compare.summary.successRate - base.summary.successRate,
		avgDurationDeltaMs:
			compare.summary.avgDurationMs - base.summary.avgDurationMs,
		base: base.summary,
		compare: compare.summary,
	};
}
