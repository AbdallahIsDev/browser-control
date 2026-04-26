import type { ConfigEntry, ConfigSetResult } from "../shared/config";
import type { DoctorReport, SetupResult, SystemStatus } from "./types";

export function formatConfigList(entries: ConfigEntry[]): string {
  const rows = entries.map((entry) => {
    const value = entry.value === undefined ? "" : String(entry.value);
    return `${entry.key.padEnd(24)} ${value.padEnd(18)} ${entry.source.padEnd(7)} ${entry.category}`;
  });
  return ["Key                      Value              Source  Category", ...rows].join("\n");
}

export function formatConfigGet(entry: ConfigEntry): string {
  const value = entry.value === undefined ? "" : String(entry.value);
  return `${entry.key}=${value} (${entry.source})`;
}

export function formatConfigSet(result: ConfigSetResult): string {
  return `Set ${result.key}=${result.value === undefined ? "" : String(result.value)}`;
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    `Browser Control doctor: ${report.overall}`,
    `Checks: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    "",
  ];
  for (const check of report.checks) {
    const critical = check.critical ? " critical" : "";
    lines.push(`[${check.status.toUpperCase()}] ${check.name} (${check.category}${critical})`);
    lines.push(`  ${check.details}`);
    if (check.status !== "pass") lines.push(`  Fix: ${check.fix}`);
  }
  return lines.join("\n");
}

export function formatSetup(result: SetupResult): string {
  const lines = [
    result.success ? "Setup complete" : "Setup completed with issues",
    `Data home: ${result.dataHome}`,
    `Config: ${result.configPath}`,
  ];
  if (result.changed.length > 0) lines.push(`Changed: ${result.changed.join(", ")}`);
  if (result.skipped.length > 0) lines.push(`Skipped: ${result.skipped.join(", ")}`);
  if (result.warnings.length > 0) lines.push(`Warnings: ${result.warnings.join("; ")}`);
  if (result.mcpConfigSnippet) {
    lines.push("MCP config snippet:");
    lines.push(JSON.stringify(result.mcpConfigSnippet, null, 2));
  }
  return lines.join("\n");
}

export function formatStatus(status: SystemStatus): string {
  return [
    `Daemon: ${status.daemon.state}${status.daemon.pid ? ` (pid ${status.daemon.pid})` : ""}`,
    `Broker: ${status.broker.reachable ? status.broker.url : "not reachable"}`,
    `Browser: provider=${status.browser.provider}, sessions=${status.browser.activeSessions}`,
    `Terminal: sessions=${status.terminal.activeSessions}`,
    `Tasks: running=${status.tasks.running}, queued=${status.tasks.queued}`,
    `Services: ${status.services.count}`,
    `Policy: ${status.policyProfile}`,
    `Data home: ${status.dataHome}`,
    `Health: ${status.health.overall} (${status.health.pass} pass, ${status.health.warn} warn, ${status.health.fail} fail)`,
  ].join("\n");
}

