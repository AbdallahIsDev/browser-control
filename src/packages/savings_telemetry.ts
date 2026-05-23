import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getPackagesDir } from "./registry";
import { convertRecordingToPackage, type RecordingSession } from "../observability/recorder";
import type { ActionResult } from "../shared/action_result";
import type { WorkflowRun } from "../workflows/types";

export type PackageSavingsRunKind = "discovery" | "replay";

export interface PackageSavingsTelemetryRecord {
  id: string;
  kind: PackageSavingsRunKind;
  packageName: string;
  workflowNameOrId?: string;
  recordingId?: string;
  runId?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  toolCalls: number;
  failures: number;
  success: boolean;
}

export interface PackageSavingsDelta {
  durationMs: number;
  durationPercent: number | null;
  toolCalls: number;
  failures: number;
}

export interface PackageSavingsComparison {
  baseline: PackageSavingsTelemetryRecord;
  replay: PackageSavingsTelemetryRecord;
  savings: PackageSavingsDelta;
}

export interface PackageReplayTelemetry {
  replay: PackageSavingsTelemetryRecord;
  comparison?: PackageSavingsComparison;
}

const TELEMETRY_FILE = "savings-telemetry.json";
const MAX_TELEMETRY_RECORDS = 200;

function telemetryPath(dataHome?: string): string {
  return path.join(getPackagesDir(dataHome), TELEMETRY_FILE);
}

function readHistory(dataHome?: string): PackageSavingsTelemetryRecord[] {
  const filePath = telemetryPath(dataHome);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isTelemetryRecord) : [];
  } catch {
    return [];
  }
}

function writeHistory(records: PackageSavingsTelemetryRecord[], dataHome?: string): void {
  const filePath = telemetryPath(dataHome);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(records.slice(0, MAX_TELEMETRY_RECORDS), null, 2)}\n`,
    "utf8",
  );
}

function isTelemetryRecord(value: unknown): value is PackageSavingsTelemetryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<PackageSavingsTelemetryRecord>;
  return typeof record.id === "string"
    && (record.kind === "discovery" || record.kind === "replay")
    && typeof record.packageName === "string"
    && typeof record.startedAt === "string"
    && typeof record.completedAt === "string"
    && typeof record.durationMs === "number"
    && typeof record.toolCalls === "number"
    && typeof record.failures === "number"
    && typeof record.success === "boolean";
}

function persistRecord(
  record: PackageSavingsTelemetryRecord,
  dataHome?: string,
): PackageSavingsTelemetryRecord {
  const history = readHistory(dataHome);
  writeHistory([record, ...history.filter((existing) => existing.id !== record.id)], dataHome);
  return record;
}

function durationBetween(startedAt: string, completedAt: string): number {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return 0;
  return Math.max(0, completed - started);
}

function latestDiscoveryBaseline(
  packageName: string,
  dataHome?: string,
): PackageSavingsTelemetryRecord | undefined {
  return readHistory(dataHome).find(
    (record) => record.kind === "discovery" && record.packageName === packageName,
  );
}

function compareRuns(
  baseline: PackageSavingsTelemetryRecord,
  replay: PackageSavingsTelemetryRecord,
): PackageSavingsComparison {
  const durationSavedMs = baseline.durationMs - replay.durationMs;
  return {
    baseline,
    replay,
    savings: {
      durationMs: durationSavedMs,
      durationPercent: baseline.durationMs > 0
        ? Math.round((durationSavedMs / baseline.durationMs) * 10000) / 100
        : null,
      toolCalls: baseline.toolCalls - replay.toolCalls,
      failures: baseline.failures - replay.failures,
    },
  };
}

export function getPackageSavingsTelemetryHistory(
  dataHome?: string,
): PackageSavingsTelemetryRecord[] {
  return readHistory(dataHome);
}

export function recordDiscoveryTelemetry(
  session: RecordingSession,
  dataHome?: string,
): PackageSavingsTelemetryRecord {
  const completedAt = session.actions.at(-1)?.timestamp ?? new Date().toISOString();
  const packageName = convertRecordingToPackage(session).manifest.name;
  const record: PackageSavingsTelemetryRecord = {
    id: `savings-discovery-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    kind: "discovery",
    packageName,
    recordingId: session.id,
    startedAt: session.startedAt,
    completedAt,
    durationMs: durationBetween(session.startedAt, completedAt),
    toolCalls: session.actions.length,
    failures: session.actions.filter((action) => Boolean(action.error)).length,
    success: session.actions.every((action) => !action.error),
  };
  return persistRecord(record, dataHome);
}

export function recordReplayTelemetry(options: {
  packageName: string;
  workflowNameOrId: string;
  startedAt: string;
  completedAt?: string;
  result: ActionResult<WorkflowRun>;
  dataHome?: string;
}): PackageReplayTelemetry {
  const completedAt = options.completedAt ?? new Date().toISOString();
  const run = options.result.data;
  const nodeResults = run?.nodeResults ?? {};
  const failedNodes = Object.values(nodeResults)
    .filter((result) => result.status === "failed").length;
  const failures = run
    ? Math.max(run.failures.length, failedNodes)
    : options.result.success ? 0 : 1;
  const replay = persistRecord({
    id: `savings-replay-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    kind: "replay",
    packageName: options.packageName,
    workflowNameOrId: options.workflowNameOrId,
    runId: run?.id,
    startedAt: options.startedAt,
    completedAt,
    durationMs: durationBetween(options.startedAt, completedAt),
    toolCalls: Object.keys(nodeResults).length,
    failures,
    success: Boolean(options.result.success && run?.status === "completed"),
  }, options.dataHome);

  const baseline = latestDiscoveryBaseline(options.packageName, options.dataHome);
  return {
    replay,
    comparison: baseline ? compareRuns(baseline, replay) : undefined,
  };
}
