/**
 * Execution Router Rules - Declarative path and risk inference tables.
 */

import type { ExecutionContext, ExecutionPath, RiskLevel } from "./types";

const DANGEROUS_SYSTEM_COMMANDS = new Set([
  "rm",
  "rmdir",
  "del",
  "format",
  "fdisk",
  "dd",
  "shutdown",
  "reboot",
  "halt",
  "kill",
]);

const COMMAND_PREFIX_WRAPPERS = new Set([
  "sudo",
  "doas",
  "time",
  "nice",
  "nohup",
  "command",
  "builtin",
]);

const SHELL_WRAPPERS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /&&|\|\||[;|&()]|"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|[^\s;|&()]+/g;
  for (const match of command.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}

function splitCommandSegments(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if ([";", "&&", "||", "|", "&"].includes(token)) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    if (token === "(" || token === ")") continue;
    current.push(token);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function commandBasename(token: string): string {
  const normalized = token
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^[\\./]+/, "")
    .replace(/[;|&()]+$/g, "")
    .replace(/\\/g, "/");
  const basename = normalized.split("/").filter(Boolean).pop() ?? normalized;
  return basename.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

function isShellCommandSwitch(token: string): boolean {
  const normalized = token.toLowerCase();
  return normalized === "-c" ||
    normalized === "-lc" ||
    normalized === "/c" ||
    normalized === "/k" ||
    normalized === "-command" ||
    normalized === "-commandwithargs";
}

function commandSegmentContainsDangerousCommand(
  segment: string[],
  depth: number,
): boolean {
  let index = 0;
  while (index < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index])) {
    index++;
  }

  while (index < segment.length) {
    const name = commandBasename(segment[index]);
    if (name === "env") {
      index++;
      while (
        index < segment.length &&
        (segment[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[index]))
      ) {
        index++;
      }
      continue;
    }
    if (COMMAND_PREFIX_WRAPPERS.has(name)) {
      index++;
      continue;
    }
    if (DANGEROUS_SYSTEM_COMMANDS.has(name)) {
      return true;
    }
    if (SHELL_WRAPPERS.has(name) && depth < 3) {
      const commandSwitchIndex = segment.findIndex((token, i) => i > index && isShellCommandSwitch(token));
      if (commandSwitchIndex >= 0 && commandSwitchIndex + 1 < segment.length) {
        return containsDangerousSystemCommand(
          segment.slice(commandSwitchIndex + 1).join(" "),
          depth + 1,
        );
      }
    }
    return false;
  }

  return false;
}

function containsDangerousSystemCommand(command: string, depth = 0): boolean {
  const tokens = tokenizeCommand(command);
  return splitCommandSegments(tokens).some((segment) =>
    commandSegmentContainsDangerousCommand(segment, depth),
  );
}

// ── Path Inference Rules ────────────────────────────────────────────────

export interface PathInferenceRule {
  matches: (action: string, params: Record<string, unknown>) => boolean;
  path: ExecutionPath;
  risk: RiskLevel;
}

// Default path inference rules
export const DEFAULT_PATH_RULES: PathInferenceRule[] = [
  // Command path - direct terminal commands
  {
    matches: (action, params) => {
      return action === "execute_command" ||
        action === "run_script" ||
        action === "terminal_execute" ||
        (action === "shell" && typeof params.command === "string");
    },
    path: "command",
    risk: "moderate",
  },

  // ── Terminal path — read-only queries (low risk) ─────────────────
  {
    matches: (action) => {
      const terminalReadActions = [
        "terminal_list", "terminal_read", "terminal_snapshot", "terminal_status",
      ];
      return terminalReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },

  // ── Terminal path (Section 12) ──────────────────────────────────
  {
    matches: (action) => {
      const terminalActions = [
        "terminal_open", "terminal_close", "terminal_write",
        "terminal_interrupt", "terminal_exec", "terminal_resume",
        "term_open", "term_close", "term_exec", "term_resume",
      ];
      return terminalActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Service path (Section 14) ───────────────────────────────────
  {
    matches: (action) => {
      const serviceReadActions = ["service_list", "service_resolve", "service_proxy_status"];
      return serviceReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => {
      const serviceMutationActions = ["service_register", "service_remove", "service_proxy_start", "service_proxy_stop"];
      return serviceMutationActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Provider path (Section 15) ──────────────────────────────────
  {
    matches: (action) => {
      const providerReadActions = [
        "browser_provider_list",
        "browser_provider_get_active",
        "browser_provider_health",
        "browser_provider_catalog",
      ];
      return providerReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action, params) => {
      if (action === "browser_provider_use") {
        return typeof params.name === "string" && params.name !== "local";
      }
      if (action === "browser_provider_add") {
        return ["custom", "browserless", "browserbase", "e2b", "cubesandbox", "camofox", "cloak", "obscura"].includes(String(params.type));
      }
      return false;
    },
    path: "command",
    risk: "high",
  },
  {
    matches: (action) => {
      const providerMutationActions = ["browser_provider_use", "browser_provider_add", "browser_provider_remove"];
      return providerMutationActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Config path (Section 11) ────────────────────────────────────
  {
    matches: (action) => {
      const configReadActions = ["config_list", "config_get"];
      return configReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => {
      const configMutationActions = ["config_set"];
      return configMutationActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Daemon path ─────────────────────────────────────────────────
  {
    matches: (action) => {
      const daemonActions = ["daemon_start", "daemon_stop", "daemon_restart"];
      return daemonActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },
  {
    matches: (action) => {
      const daemonReadActions = ["daemon_status"];
      return daemonReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },

  // ── Browser auth/profile path (Sections 8 and 15) ───────────────
  {
    matches: (action) => {
      const authProfileActions = [
        "browser_auth_export",
        "browser_auth_import",
        "browser_profile_use",
        "browser_profile_create",
        "browser_profile_delete",
      ];
      return authProfileActions.includes(action);
    },
    path: "low_level",
    risk: "high",
  },
  {
    matches: (action) => {
      const authProfileReadActions = ["browser_profile_list", "browser_auth_status"];
      return authProfileReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },

  // ── Service path (legacy aggregate aliases) ─────────────────────
  {
    matches: (action) => {
      const serviceActions = ["service_status"];
      return serviceActions.includes(action);
    },
    path: "command",
    risk: "low",
  },

  // ── Debug/observability path (Section 10) ──────────────────────────
  {
    matches: (action) => {
      const debugReadActions = ["debug_health"];
      return debugReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => action === "debug_bundle_export",
    path: "command",
    risk: "high",
  },
  {
    matches: (action) => {
      const debugEvidenceActions = ["debug_console_read", "debug_network_read"];
      return debugEvidenceActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },
  {
    matches: (action) => action === "debug_receipt_export",
    path: "command",
    risk: "low",
  },

  // ── Screencast path (Section 26) ─────────────────────────────────
  {
    matches: (action) => {
      const screencastMutationActions = ["browser_screencast_start", "browser_screencast_stop"];
      return screencastMutationActions.includes(action);
    },
    path: "low_level",
    risk: "moderate",
  },
  {
    matches: (action) => action === "browser_screencast_status",
    path: "command",
    risk: "low",
  },

  // ── Advanced browser I/O and visual helpers (Sections 25 and 27) ──
  {
    matches: (action) => {
      const browserReadActions = [
        "browser_list",
        "browser_detach",
        "browser_generate_locator",
        "browser_downloads_list",
      ];
      return browserReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => action === "browser_highlight",
    path: "a11y",
    risk: "low",
  },
  {
    matches: (action) => action === "browser_attach",
    path: "a11y",
    risk: "high",
  },
  {
    matches: (action) => action === "browser_drop_data",
    path: "a11y",
    risk: "moderate",
  },
  {
    matches: (action) => action === "browser_drop_file",
    path: "a11y",
    risk: "high",
  },

  // ── Workflow path (Section 29) ────────────────────────────────────
  {
    matches: (action) => {
      const workflowReadActions = ["workflow_status", "workflow_list"];
      return workflowReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => {
      const workflowMutationActions = [
        "workflow_run", "workflow_resume", "workflow_approve", "workflow_cancel",
      ];
      return workflowMutationActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Harness path (Section 29) ───────────────────────────────────
  {
    matches: (action) => {
      const harnessReadActions = ["harness_list", "harness_find", "harness_get"];
      return harnessReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => {
      const harnessMutationActions = ["harness_register", "harness_validate", "harness_rollback"];
      return harnessMutationActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },
  {
    matches: (action) => {
      const harnessExecActions = ["harness_activate", "harness_execute"];
      return harnessExecActions.includes(action);
    },
    path: "command",
    risk: "high",
  },

  // ── Package path (Section 30) ───────────────────────────────────
  {
    matches: (action) => {
      const packageReadActions = ["package_list", "package_info"];
      return packageReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => {
      const packageMutationActions = [
        "package_install", "package_remove", "package_update",
        "package_run", "package_eval", "package_grant"
      ];
      return packageMutationActions.includes(action);
    },
    path: "command",
    risk: "moderate",
  },

  // ── Filesystem path (Section 12) ────────────────────────────────
  {
    matches: (action) => {
      if (action === "fs_write_output") return false;
      const fsReadActions = ["fs_read", "file_read", "read_file", "fs_list", "fs_stat"];
      return fsReadActions.includes(action);
    },
    path: "command",
    risk: "low",
  },
  {
    matches: (action) => action === "fs_write_output",
    path: "command",
    risk: "moderate",
  },
  {
    matches: (action) => {
      const fsWriteActions = ["fs_write", "file_write", "write_file"];
      return fsWriteActions.includes(action);
    },
    path: "command",
    risk: "high",
  },
  {
    matches: (action) => {
      const fsDestructiveActions = ["fs_delete", "fs_move", "file_delete", "file_move", "delete_file", "move_file"];
      return fsDestructiveActions.includes(action);
    },
    path: "command",
    risk: "high",
  },

  // ── Browser Action path (Section 5) ────────────────────────────
  // Dialog response is moderate risk — must come before the broad action rule
  {
    matches: (action) => action === "browser_dialog",
    path: "a11y",
    risk: "moderate",
  },
  // Screenshot is moderate risk (may contain sensitive data) — must come
  // before the broad browser action rule so it takes priority.
  {
    matches: (action) => action === "screenshot",
    path: "a11y",
    risk: "moderate",
  },
  {
    matches: (action) => {
      const browserActions = [
        "browser_navigate", "browser_click", "browser_fill",
        "browser_hover", "browser_type", "browser_press",
        "browser_scroll", "browser_close", "browser_snapshot",
        "browser_tab_list", "browser_tab_switch", "browser_tab_close",
        "browser_capture", "browser_capture_many", "browser_open_many",
      ];
      return browserActions.includes(action);
    },
    path: "a11y",
    risk: "low",
  },

  // Low-level path - raw CDP, JS eval, network interception
  {
    matches: (action, params) => {
      return action === "cdp_execute" ||
        action === "js_evaluate" ||
        action === "network_intercept" ||
        action === "cookie_export" ||
        action === "cookie_import" ||
        action === "coordinate_action" ||
        action === "performance_trace";
    },
    path: "low_level",
    risk: "high",
  },

  // A11y path - natural language actions via Stagehand
  {
    matches: (action, params) => {
      return action === "act" ||
        action === "observe" ||
        action === "extract" ||
        action === "natural_language_action" ||
        (action === "stagehand" && typeof params.prompt === "string");
    },
    path: "a11y",
    risk: "low",
  },

  // Default fallback - assume a11y for browser actions but with moderate risk for safety
  {
    matches: () => true,
    path: "a11y",
    risk: "moderate",
  },
];
// ── Risk Adjustment Rules ────────────────────────────────────────────────

export interface RiskAdjustmentRule {
  matches: (action: string, params: Record<string, unknown>, context: ExecutionContext) => boolean;
  adjustment: (currentRisk: RiskLevel) => RiskLevel;
}

export const DEFAULT_RISK_RULES: RiskAdjustmentRule[] = [
  // State-changing browser verbs - elevate risk to high
  {
    matches: (action) => {
      if (
        action.startsWith("service_") ||
        action.startsWith("browser_provider_") ||
        action.startsWith("config_") ||
        action.startsWith("daemon_")
      ) {
        return false;
      }
      const stateChangingActions = [
        "publish", "submit", "confirm", "delete", "remove", "finalize", "approve", "reject",
        "upload", "download", "place_trade", "execute_order", "transfer", "payment", "checkout",
        "sign", "authorize", "grant", "revoke", "install", "deploy", "ship", "release",
      ];
      return stateChangingActions.some(verb => action.toLowerCase().includes(verb));
    },
    adjustment: () => "high",
  },

  // File operations - elevate risk to high
  {
    matches: (action, params) => {
      return action === "file_upload" ||
        action === "file_download" ||
        action === "file_delete" ||
        (typeof params.filePath === "string" && params.filePath.length > 0);
    },
    adjustment: () => "high",
  },

  // Credential submission - elevate risk significantly
  {
    matches: (action, params) => {
      return action === "submit_credentials" ||
        (typeof params.password !== "undefined" || typeof params.secret !== "undefined");
    },
    adjustment: () => "high",
  },

  // System-level commands - elevate risk to critical
  {
    matches: (action, params) => {
      if (action !== "execute_command" && action !== "shell") {
        return false;
      }
      const command = typeof params.command === "string" ? params.command : "";
      return containsDangerousSystemCommand(command);
    },
    adjustment: () => "critical",
  },

  // Domain-based risk - elevate for unknown or suspicious domains
  {
    matches: (action, params, context) => {
      const domain = params.domain ?? context.targetDomain;
      if (typeof domain !== "string") {
        return false;
      }
      // Basic heuristics for suspicious domains
      const suspiciousPatterns = [".onion", "bit.", "crypto", "free-", "hack", "crack"];
      return suspiciousPatterns.some(pattern => domain.toLowerCase().includes(pattern));
    },
    adjustment: (current) => current === "critical" ? "critical" : (current === "high" ? "critical" : "high"),
  },
];
