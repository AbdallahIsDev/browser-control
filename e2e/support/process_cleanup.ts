import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { CleanupReport } from "./reliability_report";
import { redactString } from "../../observability/redaction";

export interface CleanupScanOptions {
  commandFragments?: string[];
  commandFragmentGroups?: string[][];
  fixturePids?: Array<number | undefined>;
}

interface ProcessRow {
  ProcessId?: number;
  ParentProcessId?: number;
  Name?: string;
  CommandLine?: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function scanWindowsProcesses(fragments: string[], groups: string[][]): ProcessRow[] {
  if (fragments.length === 0 && groups.length === 0) return [];
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  const powershellPath = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const powershell = existsSync(powershellPath) ? powershellPath : "powershell.exe";
  const script = `
$fragments = ConvertFrom-Json $env:BC_E2E_FRAGMENTS
$groups = ConvertFrom-Json $env:BC_E2E_FRAGMENT_GROUPS
Get-CimInstance Win32_Process |
  Where-Object {
    $cmd = $_.CommandLine
    if ($_.Name -notmatch 'node|cmd|conpty|chrome|powershell|pwsh' -or $null -eq $cmd) {
      return $false
    }
    foreach ($fragment in $fragments) {
      if ($fragment -and $fragment.Length -gt 0 -and $cmd.Contains([string]$fragment)) {
        return $true
      }
    }
    foreach ($group in $groups) {
      $matchedAll = $true
      foreach ($fragment in $group) {
        if (-not $fragment -or -not $cmd.Contains([string]$fragment)) {
          $matchedAll = $false
          break
        }
      }
      if ($matchedAll) {
        return $true
      }
    }
    return $false
  } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine |
  ConvertTo-Json -Compress
`;
  const output = execFileSync(powershell, ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    env: {
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      BC_E2E_FRAGMENTS: JSON.stringify(fragments),
      BC_E2E_FRAGMENT_GROUPS: JSON.stringify(groups),
    },
    windowsHide: true,
    timeout: 10000,
  }).trim();
  if (!output) return [];
  const parsed = JSON.parse(output) as ProcessRow | ProcessRow[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function scanUnixProcesses(fragments: string[], groups: string[][]): ProcessRow[] {
  if (fragments.length === 0 && groups.length === 0) return [];
  const psPath = existsSync("/bin/ps") ? "/bin/ps" : existsSync("/usr/bin/ps") ? "/usr/bin/ps" : "ps";
  const output = execFileSync(psPath, ["-eo", "pid=,ppid=,comm=,args="], {
    encoding: "utf8",
    timeout: 10000,
  });
  return output
    .split(/\r?\n/)
    .filter((line) =>
      fragments.some((fragment) => fragment && line.includes(fragment)) ||
      groups.some((group) => group.every((fragment) => fragment && line.includes(fragment)))
    )
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return {
        ProcessId: match ? Number(match[1]) : undefined,
        ParentProcessId: match ? Number(match[2]) : undefined,
        Name: match?.[3],
        CommandLine: match?.[4] ?? line.trim(),
      };
    });
}

export async function scanForBrowserControlLeftovers(
  options: CleanupScanOptions = {},
): Promise<CleanupReport> {
  const fragments = options.commandFragments ?? [];
  const groups = options.commandFragmentGroups ?? [];
  const fixturePids = (options.fixturePids ?? []).filter((pid): pid is number => typeof pid === "number");
  const notes: string[] = [];
  let rows: ProcessRow[] = [];

  try {
    rows = process.platform === "win32" ? scanWindowsProcesses(fragments, groups) : scanUnixProcesses(fragments, groups);
  } catch (error) {
    notes.push(`process scan skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const pidLeftovers = fixturePids
    .filter(isPidAlive)
    .map((pid) => ({
      pid,
      name: "fixture-process",
      reason: "fixture pid still alive after cleanup",
    }));

  const rowLeftovers = rows
    .filter((row) => row.ProcessId !== process.pid)
    .map((row) => ({
      pid: Number(row.ProcessId ?? 0),
      parentPid: row.ParentProcessId,
      name: row.Name ?? "unknown",
      commandLine: row.CommandLine ? redactString(row.CommandLine) : undefined,
      reason: "matched scoped Browser Control E2E command fragment",
    }))
    .filter((row) => row.pid > 0);

  const leftovers = [...pidLeftovers, ...rowLeftovers];
  return {
    status: leftovers.length === 0 ? "pass" : "fail",
    checkedAt: new Date().toISOString(),
    scannedProcessCount: rows.length,
    leftovers,
    notes,
  };
}

export function summarizeCleanupFailure(cleanup: CleanupReport): string | undefined {
  if (cleanup.status === "pass") return undefined;
  const leftovers = cleanup.leftovers
    .map((leftover) => `${leftover.name} pid=${leftover.pid} ${leftover.commandLine ?? leftover.reason}`)
    .join("; ");
  const notes = cleanup.notes.length > 0 ? ` notes=${cleanup.notes.join("; ")}` : "";
  return `cleanup failed: ${leftovers || "no process details"}${notes}`;
}
