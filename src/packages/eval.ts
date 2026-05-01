import fs from "node:fs";
import path from "node:path";
import { PackageRegistry } from "./registry";
import { PackageRunner } from "./runner";
import type { MemoryStore } from "../runtime/memory_store";
import { WorkflowRuntime } from "../workflows/runtime";
import type { PackageEvalDefinition, PackageEvalResult, PackageEvalSummary } from "./types";
import { failureResult, successResult } from "../shared/action_result";
import type { ActionResult } from "../shared/action_result";
import { safeResolveRelativePath } from "./manifest";

export class PackageEval {
  constructor(
    private readonly registry: PackageRegistry,
    private readonly memoryStore: MemoryStore,
    private readonly sessionId: string,
    private readonly runtime: WorkflowRuntime
  ) {}

  async evaluate(packageName: string): Promise<ActionResult<PackageEvalResult[]>> {
    const pkg = this.registry.get(packageName);
    if (!pkg) {
      return failureResult(`Package not found: ${packageName}`, { path: "command", sessionId: this.sessionId });
    }

    if (!pkg.enabled || pkg.validationStatus !== "valid") {
      return failureResult(`Package ${packageName} is not enabled or valid`, { path: "command", sessionId: this.sessionId });
    }

    const evalResults: PackageEvalResult[] = [];
    const runner = new PackageRunner(this.registry, this.memoryStore, this.sessionId, this.runtime);
    
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let totalDurationMs = 0;

    for (const evalRelPath of pkg.evals) {
      let fullPath: string;
      try {
        fullPath = safeResolveRelativePath(pkg.installedPath, evalRelPath);
      } catch (err) {
        evalResults.push({
          evalId: evalRelPath,
          name: evalRelPath,
          status: "skipped",
          durationMs: 0,
          error: `Unsafe eval path: ${(err as Error).message}`
        });
        skippedCount++;
        continue;
      }

      if (!fs.existsSync(fullPath)) {
        evalResults.push({
          evalId: evalRelPath,
          name: evalRelPath,
          status: "skipped",
          durationMs: 0,
          error: "Eval definition file not found"
        });
        skippedCount++;
        continue;
      }

      let evalDefs: PackageEvalDefinition[] = [];
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        evalDefs = Array.isArray(content) ? content : [content];
      } catch (err) {
        evalResults.push({
          evalId: evalRelPath,
          name: evalRelPath,
          status: "failed",
          durationMs: 0,
          error: `Failed to parse eval definition: ${(err as Error).message}`
        });
        failedCount++;
        continue;
      }

      for (const def of evalDefs) {
        if (!def.id || !def.workflow) {
          evalResults.push({
            evalId: def.id ?? "unknown",
            name: def.name ?? "unknown",
            status: "failed",
            durationMs: 0,
            error: "Missing required fields in eval definition"
          });
          failedCount++;
          continue;
        }

        const startMs = Date.now();
        const expectedStatus = def.expectedStatus ?? "completed";
        const timeoutMs = def.timeoutMs || 60000;
        
        let timer: NodeJS.Timeout | undefined;
        let timedOut = false;
        const timeoutPromise = new Promise((_, reject) => {
           timer = setTimeout(() => {
             timedOut = true;
             reject(new Error(`Eval timed out after ${timeoutMs}ms`));
           }, timeoutMs);
        });

        try {
          const runResultPromise = runner.runWorkflow(packageName, def.workflow, { maxNodeTimeoutMs: timeoutMs });
          runResultPromise.then((lateResult) => {
            if (!timedOut || !lateResult.success) return;
            const runId = (lateResult.data as any)?.id;
            if (typeof runId === "string") {
              this.runtime.cancel(runId);
            }
          }).catch(() => {});
          const runResult = await Promise.race([runResultPromise, timeoutPromise]) as ActionResult;
          if (timer) clearTimeout(timer);

          const durationMs = Date.now() - startMs;
          totalDurationMs += durationMs;

          // Check if workflow execution matches expectation
          // runResult.data is WorkflowRun if it started
          const runData = runResult.data as any;
          const actualStatus = (runResult.success && runData && runData.status === "completed") 
            ? "completed" 
            : "failed";

          const passed = actualStatus === expectedStatus;

          evalResults.push({
            evalId: def.id,
            name: def.name,
            status: passed ? "passed" : "failed",
            durationMs,
            error: passed ? undefined : `Expected status ${expectedStatus}, got ${actualStatus}. ${runResult.error ?? ""}`,
            artifacts: runData?.artifacts?.map((a: any) => a.path) ?? []
          });

          if (passed) passedCount++;
          else failedCount++;

        } catch (err) {
          if (timer) clearTimeout(timer);
          const durationMs = Date.now() - startMs;
          totalDurationMs += durationMs;
          
          const passed = expectedStatus === "failed"; 
          
          evalResults.push({
            evalId: def.id,
            name: def.name,
            status: passed ? "passed" : "failed",
            durationMs,
            error: passed ? undefined : `Workflow execution failed/timed out: ${(err as Error).message}`
          });
          
          if (passed) passedCount++;
          else failedCount++;
        }
      }
    }

    const summary: PackageEvalSummary = {
      runAt: new Date().toISOString(),
      total: passedCount + failedCount + skippedCount,
      passed: passedCount,
      failed: failedCount,
      skipped: skippedCount,
      durationMs: totalDurationMs
    };

    this.registry.updateEvalSummary(packageName, summary);

    return successResult(evalResults, { path: "command", sessionId: this.sessionId });
  }
}
