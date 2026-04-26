import fs from "node:fs";
import path from "node:path";
import * as childProcess from "node:child_process";
import { getReportsDir } from "../shared/paths";

export const childProcessApi = {
  spawn: childProcess.spawn,
};

export interface TelemetryEvent {
  action: string;
  result: "success" | "error";
  durationMs: number;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface AlertEvent extends TelemetryEvent {}

export interface TelemetrySummary {
  totalSteps: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  averageDurationMs: number;
  captchasSolved: number;
  screenshotsCaptured: number;
  proxyUsage: Record<string, number>;
  actions: Record<string, {
    count: number;
    successCount: number;
    errorCount: number;
    totalDurationMs: number;
  }>;
}

interface TelemetryOptions {
  reportsDir?: string;
}

export class Telemetry {
  private readonly reportsDir: string;

  private readonly events: TelemetryEvent[] = [];

  private readonly alertHandlers: Array<(event: AlertEvent) => void> = [];

  constructor(options: TelemetryOptions = {}) {
    this.reportsDir = options.reportsDir ?? getReportsDir();
  }

  record(
    action: string,
    result: "success" | "error",
    durationMs: number,
    details: Record<string, unknown> = {},
  ): void {
    const event: TelemetryEvent = {
      action,
      result,
      durationMs,
      details,
      timestamp: new Date().toISOString(),
    };

    this.events.push(event);
    if (result === "error") {
      for (const handler of this.alertHandlers) {
        handler(event);
      }
    }
  }

  getSummary(): TelemetrySummary {
    const summary: TelemetrySummary = {
      totalSteps: this.events.length,
      successCount: 0,
      errorCount: 0,
      successRate: 0,
      averageDurationMs: 0,
      captchasSolved: 0,
      screenshotsCaptured: 0,
      proxyUsage: {},
      actions: {},
    };

    let totalDurationMs = 0;

    for (const event of this.events) {
      totalDurationMs += event.durationMs;
      if (event.result === "success") {
        summary.successCount += 1;
      } else {
        summary.errorCount += 1;
      }

      if (!summary.actions[event.action]) {
        summary.actions[event.action] = {
          count: 0,
          successCount: 0,
          errorCount: 0,
          totalDurationMs: 0,
        };
      }

      const actionSummary = summary.actions[event.action];
      actionSummary.count += 1;
      actionSummary.totalDurationMs += event.durationMs;
      if (event.result === "success") {
        actionSummary.successCount += 1;
      } else {
        actionSummary.errorCount += 1;
      }

      if (event.action === "captcha.solve" && event.result === "success") {
        summary.captchasSolved += 1;
      }

      const proxyUrl = typeof event.details?.proxyUrl === "string" ? event.details.proxyUrl : undefined;
      if (proxyUrl) {
        summary.proxyUsage[proxyUrl] = (summary.proxyUsage[proxyUrl] ?? 0) + 1;
      }

      const screenshotCount = typeof event.details?.screenshotCount === "number"
        ? event.details.screenshotCount
        : event.action === "screenshot.capture" ? 1 : 0;
      summary.screenshotsCaptured += screenshotCount;
    }

    summary.averageDurationMs = this.events.length > 0
      ? totalDurationMs / this.events.length
      : 0;
    summary.successRate = this.events.length > 0
      ? summary.successCount / this.events.length
      : 0;

    return summary;
  }

  exportReport(format: "json" | "markdown" | "html"): string {
    const summary = this.getSummary();
    if (format === "json") {
      return JSON.stringify({
        summary,
        events: this.events,
      }, null, 2);
    }

    if (format === "html") {
      return [
        "<html><head><title>Telemetry Report</title></head><body>",
        "<h1>Telemetry Report</h1>",
        `<p>Total steps: ${summary.totalSteps}</p>`,
        `<p>Success rate: ${(summary.successRate * 100).toFixed(2)}%</p>`,
        `<pre>${this.exportReport("json")}</pre>`,
        "</body></html>",
      ].join("");
    }

    return [
      "# Telemetry Report",
      `- Total steps: ${summary.totalSteps}`,
      `- Success rate: ${(summary.successRate * 100).toFixed(2)}%`,
      `- Average duration: ${summary.averageDurationMs.toFixed(2)}ms`,
      `- CAPTCHAs solved: ${summary.captchasSolved}`,
      `- Screenshots captured: ${summary.screenshotsCaptured}`,
      "",
      "## Events",
      ...this.events.map((event) => `- ${event.timestamp} | ${event.action} | ${event.result} | ${event.durationMs}ms`),
    ].join("\n");
  }

  saveReport(format: "json" | "markdown" | "html"): string {
    fs.mkdirSync(this.reportsDir, { recursive: true });
    const extension = format === "markdown" ? "md" : format;
    const filename = path.join(
      this.reportsDir,
      `report-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
    );
    fs.writeFileSync(filename, this.exportReport(format));
    return filename;
  }

  onAlert(callback: (event: AlertEvent) => void): void {
    this.alertHandlers.push(callback);
  }
}

/**
 * Resolve the best available PowerShell executable for the current platform.
 *
 * - Windows: `powershell` (built-in Windows PowerShell 5.1)
 * - Non-Windows: `pwsh` (PowerShell Core / cross-platform)
 *
 * Note: the resolved command may not exist on the system. Spawn errors
 * are caught gracefully by the caller via `child.on('error', ...)`.`
 */
export function resolvePowershellCmd(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "powershell" : "pwsh";
}

export function createTelegramAlertHandler(scriptPath = path.join(process.cwd(), "telegram_notifier.ps1")): (
  event: AlertEvent,
) => void {
  return (event: AlertEvent) => {
    if (!fs.existsSync(scriptPath)) {
      return;
    }

    const child = childProcessApi.spawn(resolvePowershellCmd(), [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-MessageType",
      "error",
      "-TaskName",
      event.action,
      "-Summary",
      JSON.stringify(event.details ?? {}),
    ], {
      stdio: "ignore",
      // Only set windowsHide on Windows — the option is ignored on other
      // platforms but keeps the intent explicit.
      windowsHide: process.platform === "win32",
    });

    // Gracefully handle spawn errors (e.g., PowerShell not installed)
    child.on("error", () => {
      // Intentionally swallowed — alert failures must not crash the daemon.
    });

    child.unref();
  };
}
