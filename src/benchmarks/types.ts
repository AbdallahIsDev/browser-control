import type { ExecutionPath } from "../policy/types";

export type BenchmarkSuiteName = "browser" | "terminal" | "filesystem" | "combined" | "package" | "trading" | "all";

export interface BenchmarkTaskResult {
	success: boolean;
	retries?: number;
	policyDecisions?: number;
	error?: string;
}

export interface BenchmarkTask {
	name: string;
	suite: Exclude<BenchmarkSuiteName, "all">;
	path: ExecutionPath;
	run(): Promise<BenchmarkTaskResult>;
}

export interface BenchmarkResult {
	name: string;
	suite: string;
	success: boolean;
	durationMs: number;
	retries: number;
	executionPath: ExecutionPath;
	policyDecisions: number;
	error?: string;
	timestamp: string;
}

export interface BenchmarkSuiteResult {
	suite: string;
	totalBenchmarks: number;
	passed: number;
	failed: number;
	successRate: number;
	avgDurationMs: number;
	pathBreakdown: {
		command: number;
		a11y: number;
		lowLevel: number;
	};
	timestamp: string;
}

export interface BenchmarkRunRecord {
	runId: string;
	suite: string;
	startedAt: string;
	completedAt: string;
	iterations: number;
	results: BenchmarkResult[];
	summary: BenchmarkSuiteResult;
}

export interface BenchmarkRunOutput extends BenchmarkRunRecord {
	savedPath: string;
}

export interface BenchmarkComparison {
	baseRunId: string;
	compareRunId: string;
	successRateDelta: number;
	avgDurationDeltaMs: number;
	base: BenchmarkSuiteResult;
	compare: BenchmarkSuiteResult;
}
