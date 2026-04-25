import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type WorkflowStatus = "pass" | "fail" | "skip";
export type CleanupStatus = "pass" | "fail" | "skip";

export interface CleanupReport {
  status: CleanupStatus;
  checkedAt: string;
  scannedProcessCount: number;
  leftovers: Array<{
    pid: number;
    parentPid?: number;
    name: string;
    commandLine?: string;
    reason: string;
  }>;
  notes: string[];
}

export interface ReliabilityWorkflowReport {
  name: string;
  status: WorkflowStatus;
  durationMs: number;
  retryCount: number;
  cleanup: CleanupReport;
  debugBundleId?: string;
  errorSummary?: string;
}

export interface ReliabilityRunReport {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  workflows: ReliabilityWorkflowReport[];
}

const SAFE_RUN_ID = /^[a-zA-Z0-9._-]+$/;

function createRunId(): string {
  const requested = process.env.BC_E2E_REPORT_RUN_ID;
  if (requested && SAFE_RUN_ID.test(requested)) return requested;
  return `golden-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function resolveReportPath(outputDir: string, runId: string): string {
  const outputRoot = path.resolve(outputDir);
  const requested = process.env.BC_E2E_REPORT_PATH;
  if (requested) {
    const resolved = path.resolve(requested);
    if (resolved === outputRoot || resolved.startsWith(`${outputRoot}${path.sep}`)) {
      return resolved;
    }
  }
  return path.join(outputRoot, `${runId}.json`);
}

export function createRunReport(): ReliabilityRunReport {
  return {
    runId: createRunId(),
    startedAt: process.env.BC_E2E_REPORT_STARTED_AT ?? new Date().toISOString(),
    workflows: [],
  };
}

export function recordWorkflow(
  report: ReliabilityRunReport,
  workflow: ReliabilityWorkflowReport,
): ReliabilityRunReport {
  report.workflows.push(workflow);
  return report;
}

export function finishRunReport(report: ReliabilityRunReport): ReliabilityRunReport {
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - new Date(report.startedAt).getTime();
  return report;
}

export function getReliabilityReportDir(): string {
  return path.join(process.cwd(), "reports", "e2e");
}

export function writeReliabilityReport(
  report: ReliabilityRunReport,
  outputDir = getReliabilityReportDir(),
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = resolveReportPath(outputDir, report.runId);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const aggregate = process.env.BC_E2E_REPORT_PATH && fs.existsSync(outputPath)
    ? (JSON.parse(fs.readFileSync(outputPath, "utf8")) as ReliabilityRunReport)
    : { ...report, workflows: [] };

  aggregate.workflows.push(...report.workflows);
  aggregate.finishedAt = report.finishedAt;
  aggregate.durationMs = report.durationMs;
  fs.writeFileSync(outputPath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  return outputPath;
}
