/**
 * Performance Instrumentation — Traces and slow step detection.
 *
 * Not on by default for every task. Supports:
 *   - traces (start/end/duration per step)
 *   - slow step detection
 *   - memory snapshots where relevant
 */

import type { PerformanceTrace } from "./types";
import type { ExecutionPath } from "../policy";

export interface TraceOptions {
  taskId: string;
  sessionId: string;
}

export class PerformanceTracer {
  private traces = new Map<string, PerformanceTrace>();
  private activeSteps = new Map<string, { traceId: string; startMs: number }>();

  startTrace(options: TraceOptions): string {
    const traceId = `trace-${options.taskId}-${Date.now()}`;
    const trace: PerformanceTrace = {
      traceId,
      taskId: options.taskId,
      sessionId: options.sessionId,
      steps: [],
      startedAt: new Date().toISOString(),
    };
    this.traces.set(traceId, trace);
    return traceId;
  }

  startStep(traceId: string, stepId: string, name: string, path: ExecutionPath): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const startMs = Date.now();
    this.activeSteps.set(stepId, { traceId, startMs });

    trace.steps.push({
      stepId,
      name,
      startMs,
      path,
      status: "running",
    });
  }

  endStep(traceId: string, stepId: string, status: "completed" | "failed" = "completed"): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const active = this.activeSteps.get(stepId);
    const endMs = Date.now();
    const startMs = active?.startMs ?? endMs;

    const step = trace.steps.find((s) => s.stepId === stepId);
    if (step) {
      step.endMs = endMs;
      step.durationMs = endMs - startMs;
      step.status = status;
    }

    this.activeSteps.delete(stepId);
  }

  endTrace(traceId: string): PerformanceTrace | undefined {
    const trace = this.traces.get(traceId);
    if (!trace) return undefined;

    trace.endedAt = new Date().toISOString();
    return trace;
  }

  getTrace(traceId: string): PerformanceTrace | undefined {
    return this.traces.get(traceId);
  }

  getSlowSteps(traceId: string, thresholdMs: number): Array<{ stepId: string; name: string; durationMs: number }> {
    const trace = this.traces.get(traceId);
    if (!trace) return [];

    return trace.steps
      .filter((s) => s.durationMs !== undefined && s.durationMs > thresholdMs)
      .map((s) => ({
        stepId: s.stepId,
        name: s.name,
        durationMs: s.durationMs!,
      }));
  }

  clearTrace(traceId: string): void {
    this.traces.delete(traceId);
  }

  clearAll(): void {
    this.traces.clear();
    this.activeSteps.clear();
  }
}

let globalTracer: PerformanceTracer | null = null;

export function getGlobalPerformanceTracer(): PerformanceTracer {
  if (!globalTracer) {
    globalTracer = new PerformanceTracer();
  }
  return globalTracer;
}

export function resetGlobalPerformanceTracer(): void {
  globalTracer = null;
}