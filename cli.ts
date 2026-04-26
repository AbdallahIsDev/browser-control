#!/usr/bin/env ts-node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MemoryStore } from "./runtime/memory_store";
import { isPolicyAllowed, SessionManager } from "./session_manager";
import { loadProxyConfigs } from "./proxy_manager";
import { Telemetry } from "./runtime/telemetry";
import { getPidFilePath, getReportsDir, ensureDataHome, getSkillsDataDir } from "./shared/paths";
import { loadConfig } from "./shared/config";
import { spawnDaemonProcess } from "./runtime/daemon_launch";
import { getConfigEntries, getConfigValue, setUserConfigValue } from "./shared/config";
import { runDoctor } from "./operator/doctor";
import { runSetup } from "./operator/setup";
import { collectStatus } from "./operator/status";
import {
  formatConfigGet,
  formatConfigList,
  formatConfigSet,
  formatDoctor,
  formatSetup,
  formatStatus,
} from "./operator/format";

// DEFAULT_PORT kept for help text; actual port comes from loadConfig()

interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string>;
  positional: string[];
}

const VALUE_FLAGS = new Set([
  "action",
  "amount",
  "api-key",
  "cdp-url",
  "chrome-bind-address",
  "chrome-debug-port",
  "content",
  "cron",
  "cwd",
  "delay",
  "endpoint",
  "ext",
  "kind",
  "max-bytes",
  "name",
  "output",
  "params",
  "path",
  "policy",
  "port",
  "priority",
  "profile",
  "browser-mode",
  "browserless-api-key",
  "browserless-endpoint",
  "protocol",
  "provider",
  "root-selector",
  "session",
  "shell",
  "terminal-shell",
  "skill",
  "target",
  "target-type",
  "timeout",
  "timeoutMs",
  "type",
  "wait-until",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: "",
    subcommand: undefined,
    flags: {},
    positional: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const flagPart = arg.slice(2);
      const eqIndex = flagPart.indexOf("=");
      if (eqIndex !== -1) {
        const key = flagPart.slice(0, eqIndex);
        const value = flagPart.slice(eqIndex + 1);
        result.flags[key] = value;
      } else if (VALUE_FLAGS.has(flagPart) && args[i + 1] && !args[i + 1].startsWith("-")) {
        result.flags[flagPart] = args[i + 1];
        i++;
      } else {
        result.flags[flagPart] = "true";
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Handle short flags like -h
      const key = arg.slice(1);
      result.flags[key] = "true";
    } else if (!result.command) {
      result.command = arg;
    } else if (!result.subcommand) {
      result.subcommand = arg;
    } else {
      result.positional.push(arg);
    }

    i++;
  }

  return result;
}

function getApiUrl(): string {
  const config = loadConfig({ validate: false });
  return `http://127.0.0.1:${config.brokerPort}/api/v1`;
}

async function apiRequest(endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  const url = `${getApiUrl()}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(`API ${method} ${endpoint} failed with HTTP ${response.status}: ${errorBody}`);
  }
  return response.json();
}

function outputJson(data: unknown, pretty = true): void {
  console.log(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

function requireCliPolicy(action: string, params: Record<string, unknown>, jsonOutput: boolean): void {
  const store = new MemoryStore({ filename: ":memory:" });
  try {
    const manager = new SessionManager({ memoryStore: store });
    const policyEval = manager.evaluateAction(action, params);
    if (!isPolicyAllowed(policyEval)) {
      if (jsonOutput) outputJson(policyEval, false);
      else console.error(policyEval.error ?? "Policy denied.");
      process.exit(1);
    }
  } finally {
    store.close();
  }
}

function printHelp(): void {
  console.log(`
Browser Control CLI

Usage: bc <command> [subcommand] [options]

Operator:
  doctor [--json]                                                    Run operator diagnostics
  setup [--json] [--non-interactive] [--profile=balanced] [--browser-mode=managed|attach]
        [--chrome-debug-port=9222] [--chrome-bind-address=127.0.0.1]
        [--terminal-shell=powershell] [--browserless-endpoint=<url>]
        [--browserless-api-key=<key>] [--skip-browser-test] [--skip-terminal-test]
                                                                      Create/update user config
  config list|get|set                                                Inspect or update effective config
  status [--json]                                                    Show daemon, broker, sessions, tasks, and health

Browser Actions:
  open <url>                                                         Open a URL in the browser
  snapshot                                                           Take an accessibility snapshot
  click <ref-or-target>                                              Click an element (ref, selector, or text)
  fill <ref-or-target> <text>                                        Fill an element with text
  hover <ref-or-target>                                             Hover over an element
  type <text>                                                        Type text into focused element
  press <key>                                                        Press a keyboard key
  scroll <direction>                                                 Scroll (up/down/left/right)
  screenshot [--output=<path>] [--full-page] [--target=<ref>]         Take a screenshot
  tab list                                                           List browser tabs
  tab switch <id>                                                    Switch to a browser tab
  close                                                              Close the current browser tab

Session:
  session list                                                       List sessions
  session create <name> [--policy=balanced]                         Create a new session
  session use <name-or-id>                                          Set the active session
  session status                                                     Show active session status

Browser Lifecycle:
  browser attach [--port=9222] [--cdp-url=...] [--target-type=chrome|chromium|electron] [--provider=<name>]
                                                                      Attach to running Chrome/Electron
  browser launch [--port=9222] [--profile=default] [--provider=<name>]  Launch managed automation browser
  browser status                                                     Show browser connection status
  browser provider list                                              List browser providers
  browser provider use <name>                                        Set active browser provider
  browser provider add <name> --type=<type> --endpoint=<url>         Add or configure a browser provider
  browser provider remove <name>                                     Remove a configured browser provider
  browser profile list                                                List browser profiles
  browser profile create <name> [--type=named]                       Create a browser profile
  browser profile use <name>                                          Activate a browser profile
  browser profile delete <name>                                       Delete a browser profile
  browser auth export [--live | --stored] [--profile=default]         Export auth state (cookies/storage)
  browser auth import <file> [--live | --stored]                      Import auth state from file
  run --skill=<name> --action=<action> [--params='{"key":"value"}']  Run a task
  schedule <id> --cron="*/5 * * * *" --skill=<name> --action=<action> Schedule a task
  schedule list                                                      List scheduled tasks
  schedule pause <id>                                                Pause a scheduled task
  schedule resume <id>                                               Resume a scheduled task
  schedule remove <id>                                               Remove a scheduled task
  daemon start [--visible]                                           Start the daemon
  daemon stop                                                        Stop the daemon
  daemon status                                                      Check daemon status
  daemon health                                                      Run health checks
  daemon logs                                                        View daemon logs
  proxy test                                                         Test proxies
  proxy add <url>                                                    Add a proxy
  proxy remove <url>                                                 Remove a proxy
  proxy list                                                         List proxies
  memory stats                                                       Show memory stats
  memory clear                                                       Clear memory
  memory get <key>                                                   Get a memory key
  memory set <key> <value>                                           Set a memory key
  skill list                                                         List skills (name, version, actions)
  skill health <name>                                                Check skill health
  skill actions <name>                                               Show skill action metadata
  skill install <path>                                               Install a packaged skill from a directory
  skill validate <name-or-path>                                      Validate a skill manifest
  skill remove <name>                                                Remove an installed skill
  report generate                                                    Generate report
  report view                                                        View report
  captcha test                                                       Validate captcha solver configuration
  policy list                                                        List built-in policy profiles
  policy inspect <name>                                              Inspect a policy profile
  policy export <name> [file]                                         Export a policy profile to JSON
  policy import <file>                                               Import a custom policy profile
  knowledge list [--kind=interaction-skill|domain-skill]             List knowledge artifacts
  knowledge show <name-or-domain>                                    Show knowledge for a domain or skill
  knowledge validate [--all]                                         Validate knowledge files
  knowledge prune <name-or-domain>                                   Remove stale entries (not full delete)
  knowledge delete <name-or-domain>                                  Delete entire knowledge artifact
  term open [--shell=<name>] [--cwd=<path>] [--name=<name>]           Open a terminal session
  term exec "<command>" [--session=<id>] [--timeout=<ms>]             Execute a command
  term type "<text>" --session=<id>                                   Type into a session
  term read [--session=<id>] [--max-bytes=<n>]                        Read recent output
  term snapshot [--session=<id>]                                      Capture terminal state
  term interrupt --session=<id>                                       Send Ctrl+C
  term close --session=<id>                                           Close a session
  term list                                                           List active sessions
  term resume <sessionId>                                             Resume a session from persisted state
  term status <sessionId>                                             Show resume status for a session
  fs read <path> [--max-bytes=<n>]                                    Read a file
  fs write <path> [--content=<text>]                                  Write to a file
  fs ls <path> [--recursive] [--ext=<.ext>]                           List directory
  fs move <src> <dst>                                                 Move/rename
  fs rm <path> [--recursive] [--force]                                Delete file/dir
  fs stat <path>                                                      File metadata

Service Management:
  service register <name> --port <port> [--protocol=http|https] [--path=/...] [--detect] [--cwd=<path>]
  service list                                                        List registered services
  service resolve <name>                                              Resolve service to URL
  service remove <name>                                               Remove a service

Debug:
  debug bundle <id> [--output=<path>]                                 Retrieve a debug bundle
  debug console [--session=<id>]                                      Show captured console entries
  debug network [--session=<id>]                                      Show captured network entries

MCP:
  mcp serve                                                           Start MCP stdio server

Knowledge:
  knowledge list [--kind=interaction-skill|domain-skill]             List knowledge artifacts
  knowledge show <name-or-domain>                                    Show knowledge for a domain or skill
  knowledge validate [--all]                                         Validate knowledge files
  knowledge prune <name-or-domain>                                   Remove stale entries (not full delete)
  knowledge delete <name-or-domain>                                  Delete entire knowledge artifact

Flags:
  --json                                                             Raw JSON output
  --help, -h                                                         Show help

Environment:
  BROKER_PORT                                                        Broker API port (default: 7788)
`);
}

async function handleDoctor(args: ParsedArgs): Promise<void> {
  const jsonOutput = args.flags.json === "true";
  const result = await runDoctor();
  if (jsonOutput) {
    outputJson(result.report, false);
  } else {
    console.log(formatDoctor(result.report));
  }
  process.exitCode = result.exitCode;
}

async function handleSetup(args: ParsedArgs): Promise<void> {
  const jsonOutput = args.flags.json === "true";
  const result = await runSetup({
    nonInteractive: args.flags["non-interactive"] === "true",
    json: jsonOutput,
    profile: args.flags.profile,
    browserMode: args.flags["browser-mode"] as "managed" | "attach" | undefined,
    chromeDebugPort: args.flags["chrome-debug-port"] ? Number(args.flags["chrome-debug-port"]) : undefined,
    chromeBindAddress: args.flags["chrome-bind-address"],
    terminalShell: args.flags["terminal-shell"] ?? args.flags.shell,
    browserlessEndpoint: args.flags["browserless-endpoint"],
    browserlessApiKey: args.flags["browserless-api-key"],
    skipBrowserTest: args.flags["skip-browser-test"] === "true",
    skipTerminalTest: args.flags["skip-terminal-test"] === "true",
  });
  if (jsonOutput) outputJson(result, false);
  else console.log(formatSetup(result));
  process.exitCode = result.success ? 0 : 1;
}

async function handleConfig(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "list": {
      const entries = getConfigEntries({ validate: false });
      if (jsonOutput) outputJson(entries, false);
      else console.log(formatConfigList(entries));
      break;
    }
    case "get": {
      const key = positional[0];
      if (!key) {
        console.error("Error: config get requires a key");
        process.exit(1);
      }
      const entry = getConfigValue(key, { validate: false });
      if (jsonOutput) outputJson(entry, false);
      else console.log(formatConfigGet(entry));
      break;
    }
    case "set": {
      const key = positional[0];
      const value = positional[1];
      if (!key || value === undefined) {
        console.error("Error: config set requires <key> <value>");
        process.exit(1);
      }
      requireCliPolicy("config_set", { key, value }, jsonOutput);
      const result = setUserConfigValue(key, value);
      if (jsonOutput) outputJson(result, false);
      else console.log(formatConfigSet(result));
      break;
    }
    default:
      console.error(`Unknown config command: ${subcommand}`);
      console.error("Available: list, get, set");
      process.exit(1);
  }
}

async function handleStatus(args: ParsedArgs): Promise<void> {
  const jsonOutput = args.flags.json === "true";
  const status = await collectStatus();
  if (jsonOutput) outputJson(status, false);
  else console.log(formatStatus(status));
}

async function handleRun(args: ParsedArgs): Promise<void> {
  const { flags } = args;
  const jsonOutput = flags.json === "true";

  if (!flags.skill || !flags.action) {
    console.error("Error: --skill and --action are required");
    process.exit(1);
  }

  const body: Record<string, unknown> = {};
  if (flags.skill) body.skill = flags.skill;
  if (flags.action) body.action = flags.action;
  if (flags.params) {
    try {
      body.params = JSON.parse(flags.params);
    } catch {
      console.error("Error: Invalid JSON in --params");
      process.exit(1);
    }
  }
  if (flags.priority) body.priority = flags.priority;
  if (flags.timeoutMs) body.timeoutMs = Number(flags.timeoutMs);

  try {
    const result = await apiRequest("/tasks/run", "POST", body);
    outputJson(result, !jsonOutput);
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

async function handleSchedule(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "list": {
      try {
        const result = await apiRequest("/scheduler");
        outputJson(result, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "pause":
    case "resume": {
      const id = positional[0];
      if (!id) {
        console.error("Error: Task ID is required");
        process.exit(1);
      }
      try {
        const result = await apiRequest(`/scheduler/${id}/${subcommand}`, "POST");
        outputJson(result, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "remove": {
      const id = positional[0];
      if (!id) {
        console.error("Error: Task ID is required");
        process.exit(1);
      }
      try {
        const result = await apiRequest(`/scheduler/${id}`, "DELETE");
        outputJson(result, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    default: {
      // Schedule a new task: schedule <id> --cron=... --skill=... --action=...
      const id = subcommand;
      if (!id) {
        console.error("Error: Task ID is required");
        process.exit(1);
      }
      if (!flags.cron) {
        console.error("Error: --cron is required");
        process.exit(1);
      }

      const body: Record<string, unknown> = {
        id,
        name: flags.name || id,
        cronExpression: flags.cron,
      };

      if (flags.skill) body.skill = flags.skill;
      if (flags.action) body.action = flags.action;
      if (flags.params) {
        try {
          body.params = JSON.parse(flags.params);
        } catch {
          console.error("Error: Invalid JSON in --params");
          process.exit(1);
        }
      }

      try {
        const result = await apiRequest("/tasks/schedule", "POST", body);
        outputJson(result, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }
  }
}

// ── Daemon Cleanup Helpers (imported from shared module) ─────────────

import {
  cleanupStaleDaemonFiles,
  stopDaemon,
} from "./runtime/daemon_cleanup";

/**
 * CLI-specific wrapper: clean up stale daemon-status.json for the
 * default (non-isolated) home directory.
 */
function cleanupStaleDaemonStatus(): void {
  cleanupStaleDaemonFiles();
}

async function handleDaemon(args: ParsedArgs): Promise<void> {
  const { subcommand, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "start": {
      const daemonProcess = spawnDaemonProcess({
        visible: flags.visible === "true",
        detached: true,
      });

      const errorChunks: Buffer[] = [];
      daemonProcess.stderr?.on("data", (chunk: Buffer) => {
        errorChunks.push(chunk);
      });

      // Wait to detect immediate crashes. On Windows with ts-node,
      // the daemon can take several seconds to compile before the
      // broker starts listening, so we use a generous timeout.
      const startupTimeout = 8000;
      const exited = await new Promise<boolean>((resolve) => {
        daemonProcess.on("exit", () => resolve(true));
        setTimeout(() => resolve(false), startupTimeout);
      });

      if (exited) {
        const errorOutput = Buffer.concat(errorChunks).toString("utf8");
        console.error("Daemon failed to start:", errorOutput || "Process exited immediately");
        // Clean up the child process handle — daemon is already dead,
        // but the stderr pipe and listeners still hold references.
        daemonProcess.stderr?.destroy();
        daemonProcess.removeAllListeners();
        process.exit(1);
      }

      // Process is still running after timeout — ensure data dir and persist PID.
      // CRITICAL: destroy() the stderr stream to close the underlying pipe FD.
      // Without this, the open pipe handle keeps the Node.js event loop alive,
      // preventing the CLI process from exiting (the cold-start hang bug).
      daemonProcess.stderr?.destroy();
      daemonProcess.removeAllListeners();
      const interopDir = path.dirname(getPidFilePath());
      if (!fs.existsSync(interopDir)) {
        fs.mkdirSync(interopDir, { recursive: true });
      }
      fs.writeFileSync(getPidFilePath(), String(daemonProcess.pid));
      daemonProcess.unref();

      // Probe the daemon with retries to confirm it's ready.
      // Two-stage probe: first /health (broker is listening), then
      // /api/v1/term/sessions (terminal endpoints are wired up).
      // This prevents the race where the broker responds to /health
      // before terminal action endpoints are ready.
      const { probeDaemonHealth, probeTerminalReadiness } = await import("./session_manager");
      let daemonReady = false;
      let daemonBrokerUrl = "";
      // On Windows with ts-node, the daemon can take 10-20 seconds
      // to compile and initialize before the broker starts listening.
      const maxRetries = 30;
      const retryDelayMs = 1000;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const healthResult = await probeDaemonHealth();
        if (healthResult.running) {
          // Health OK — verify terminal readiness too
          const termReady = await probeTerminalReadiness(healthResult.brokerUrl);
          if (termReady) {
            daemonReady = true;
            daemonBrokerUrl = healthResult.brokerUrl;
            break;
          }
          // Health OK but terminal not ready — keep retrying
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }

      if (daemonReady) {
        console.log(`Daemon started with PID: ${daemonProcess.pid} (ready at ${daemonBrokerUrl})`);
      } else {
        console.log(`Daemon started with PID: ${daemonProcess.pid} (health endpoint not yet reachable — may still be initializing)`);
      }
      break;
    }

    case "stop": {
      if (!fs.existsSync(getPidFilePath())) {
        console.log("Daemon is not running (no PID file)");
        // Still clean up stale status file if daemon is gone
        cleanupStaleDaemonStatus();
        process.exit(1);
      }

      const pid = Number(fs.readFileSync(getPidFilePath(), "utf8").trim());
      try {
        await stopDaemon();
        console.log(`Daemon stopped (PID: ${pid})`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          fs.unlinkSync(getPidFilePath());
          cleanupStaleDaemonStatus();
          console.log("Daemon was not running (stale PID file removed)");
        } else {
          // Do NOT delete the PID file on real errors (e.g., access denied).
          // The user may need to retry `bc daemon stop` after fixing
          // permissions, and the PID file is essential for that.
          console.error("Error:", (error as Error).message);
          process.exit(1);
        }
      }
      break;
    }

    case "status": {
      if (!fs.existsSync(getPidFilePath())) {
        // No PID file — daemon is not running. Also clean up stale
        // daemon-status.json that may claim "running" from a previous
        // crash/force-kill.
        cleanupStaleDaemonStatus();
        console.log(jsonOutput ? '{"running":false}' : "Daemon is not running");
        break;
      }

      const pid = Number(fs.readFileSync(getPidFilePath(), "utf8").trim());
      try {
        process.kill(pid, 0); // Check if process exists
        const status = { running: true, pid };
        outputJson(status, !jsonOutput);
      } catch {
        // PID file exists but process is dead — stale state.
        // Remove both the PID file and the stale daemon-status.json.
        fs.unlinkSync(getPidFilePath());
        cleanupStaleDaemonStatus();
        console.log(jsonOutput ? '{"running":false}' : "Daemon is not running");
      }
      break;
    }

    case "health": {
      try {
        const result = await apiRequest("/health");
        outputJson(result, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "logs": {
      const reportsDir = getReportsDir();
      if (!fs.existsSync(reportsDir)) {
        console.log("No reports directory found");
        break;
      }

      const files = fs.readdirSync(reportsDir)
        .filter(f => f.endsWith(".json"))
        .sort()
        .reverse();

      if (files.length === 0) {
        console.log("No log files found");
        break;
      }

      // Show most recent log
      const latestFile = files[0];
      const content = fs.readFileSync(path.join(reportsDir, latestFile), "utf8");
      const parsed = JSON.parse(content);
      outputJson(parsed, !jsonOutput);
      break;
    }

    default:
      console.error(`Unknown daemon command: ${subcommand}`);
      process.exit(1);
  }
}

async function handleProxy(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "test": {
      try {
        const configs = loadProxyConfigs();
        const results = [];
        for (const config of configs) {
          results.push({ url: config.url, status: config.status });
        }
        outputJson(results, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "add": {
      const url = positional[0];
      if (!url) {
        console.error("Error: Proxy URL is required");
        process.exit(1);
      }

      try {
        const proxyPath = path.join(process.cwd(), "proxies.json");
        let configs = [];
        if (fs.existsSync(proxyPath)) {
          configs = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
        }

        if (configs.some((c: { url: string }) => c.url === url)) {
          console.log("Proxy already exists");
          break;
        }

        configs.push({ url, status: "active" });
        fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
        console.log(`Proxy added: ${url}`);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "remove": {
      const url = positional[0];
      if (!url) {
        console.error("Error: Proxy URL is required");
        process.exit(1);
      }

      try {
        const proxyPath = path.join(process.cwd(), "proxies.json");
        if (!fs.existsSync(proxyPath)) {
          console.log("No proxies configured");
          break;
        }

        let configs = JSON.parse(fs.readFileSync(proxyPath, "utf8"));
        const initialLength = configs.length;
        configs = configs.filter((c: { url: string }) => c.url !== url);

        if (configs.length === initialLength) {
          console.log("Proxy not found");
          break;
        }

        fs.writeFileSync(proxyPath, JSON.stringify(configs, null, 2));
        console.log(`Proxy removed: ${url}`);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "list": {
      try {
        const configs = loadProxyConfigs();
        outputJson(configs, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown proxy command: ${subcommand}`);
      process.exit(1);
  }
}

async function handleMemory(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const store = new MemoryStore();

  try {
    switch (subcommand) {
      case "stats": {
        const stats = store.getStats();
        outputJson(stats, !jsonOutput);
        break;
      }

      case "clear": {
        store.clear();
        console.log("Memory cleared");
        break;
      }

      case "get": {
        const key = positional[0];
        if (!key) {
          console.error("Error: Key is required");
          process.exit(1);
        }
        const value = store.get(key);
        if (value === null) {
          console.log("Key not found");
        } else {
          outputJson({ key, value }, !jsonOutput);
        }
        break;
      }

      case "set": {
        const key = positional[0];
        const value = positional[1];
        if (!key || value === undefined) {
          console.error("Error: Key and value are required");
          process.exit(1);
        }
        store.set(key, value);
        console.log(`Key set: ${key}`);
        break;
      }

      default:
        console.error(`Unknown memory command: ${subcommand}`);
        process.exit(1);
    }
  } finally {
    store.close();
  }
}

async function handleSkill(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "list": {
      try {
        const result = await apiRequest("/skills") as Array<Record<string, unknown>>;
        if (jsonOutput) {
          outputJson(result, false);
        } else {
          // Enhanced list: show name, version, health, last run time
          if (!Array.isArray(result) || result.length === 0) {
            console.log("No skills registered.");
            break;
          }
          for (const skill of result) {
            const name = skill.name ?? "?";
            const version = skill.version ?? "?";
            const actions = Array.isArray(skill.actions) ? ` (${skill.actions.length} action(s))` : "";
            console.log(`  ${name}@${version}${actions}`);
          }
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "health": {
      const name = positional[0];
      if (!name) {
        console.error("Error: Skill name is required");
        process.exit(1);
      }
      try {
        const result = await apiRequest(`/skills/${name}/health`);
        outputJson(result, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "actions": {
      const name = positional[0];
      if (!name) {
        console.error("Error: Skill name is required");
        process.exit(1);
      }
      try {
        const skills = await apiRequest("/skills") as Array<Record<string, unknown>>;
        const skill = skills.find((s) => s.name === name);
        if (!skill) {
          console.error(`Error: Skill "${name}" not found`);
          process.exit(1);
        }
        const actions = skill.actions as Array<Record<string, unknown>> | undefined;
        if (!actions || actions.length === 0) {
          console.log(`No actions declared for skill "${name}".`);
          break;
        }
        if (jsonOutput) {
          outputJson(actions, false);
        } else {
          for (const action of actions) {
            const actionName = action.name ?? "?";
            const desc = action.description ?? "";
            const params = Array.isArray(action.params) ? action.params as Array<Record<string, unknown>> : [];
            const paramStr = params.length > 0
              ? ` — params: ${params.map((p) => `${p.name}${p.required ? "*" : ""}:${p.type}`).join(", ")}`
              : "";
            console.log(`  ${actionName}: ${desc}${paramStr}`);
          }
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "install": {
      const skillPath = positional[0];
      if (!skillPath) {
        console.error("Error: Path to skill directory is required");
        process.exit(1);
      }
      // Validate locally before installing
      const { SkillRegistry } = await import("./skill_registry");
      const registry = new SkillRegistry();
      const { isPackagedSkillDir, loadPackagedSkillDir } = await import("./skill_yaml");
      const { validateManifest } = await import("./skill_registry");

      if (!isPackagedSkillDir(skillPath)) {
        console.error(`Error: "${skillPath}" is not a packaged skill directory (missing skill.yaml)`);
        process.exit(1);
      }

      const meta = loadPackagedSkillDir(skillPath);
      if (!meta) {
        console.error(`Error: Failed to load skill.yaml from "${skillPath}"`);
        process.exit(1);
      }

      const validation = validateManifest(meta.manifest);
      if (!validation.valid) {
        console.error(`Validation failed:`);
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      const skillsDir = getSkillsDataDir();
      const result = registry.installSkill(skillPath, skillsDir);
      if (!result.success) {
        console.error(`Install failed: ${result.error}`);
        process.exit(1);
      }
      console.log(`Skill "${result.name}" installed to ${skillsDir}`);
      break;
    }

    case "validate": {
      const nameOrPath = positional[0];
      if (!nameOrPath) {
        console.error("Error: Skill name or path is required");
        process.exit(1);
      }

      const { SkillRegistry } = await import("./skill_registry");
      const { isPackagedSkillDir, loadPackagedSkillDir } = await import("./skill_yaml");
      const { validateManifest } = await import("./skill_registry");
      const registry = new SkillRegistry();

      // Check if it's a path to a packaged skill
      if (isPackagedSkillDir(nameOrPath)) {
        const meta = loadPackagedSkillDir(nameOrPath);
        if (!meta) {
          console.error(`Error: Failed to load skill.yaml from "${nameOrPath}"`);
          process.exit(1);
        }
        const validation = validateManifest(meta.manifest);
        outputJson(validation, !jsonOutput);
        break;
      }

      // Check if it's a registered skill name (via API)
      try {
        const skills = await apiRequest("/skills") as Array<Record<string, unknown>>;
        const skill = skills.find((s) => s.name === nameOrPath);
        if (!skill) {
          console.error(`Error: Skill "${nameOrPath}" not found (not a path or registered name)`);
          process.exit(1);
        }
        const validation = validateManifest(skill as unknown as import("./skill").SkillManifest);
        outputJson(validation, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "remove": {
      const name = positional[0];
      if (!name) {
        console.error("Error: Skill name is required");
        process.exit(1);
      }
      const { SkillRegistry } = await import("./skill_registry");
      const registry = new SkillRegistry();
      const skillsDir = getSkillsDataDir();
      const result = registry.removeSkill(name, skillsDir);
      if (!result.success) {
        console.error(`Remove failed: ${result.error}`);
        process.exit(1);
      }
      console.log(`Skill "${name}" removed.`);
      break;
    }

    default:
      console.error(`Unknown skill command: ${subcommand}`);
      process.exit(1);
  }
}

async function handleReport(args: ParsedArgs): Promise<void> {
  const { subcommand, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "generate": {
      try {
        const telemetry = new Telemetry();
        const summary = telemetry.getSummary();
        const reportPath = telemetry.saveReport("json");
        console.log(`Report generated: ${reportPath}`);
        outputJson(summary, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "view": {
      try {
        const reportsDir = getReportsDir();
        if (!fs.existsSync(reportsDir)) {
          console.log("No reports found");
          break;
        }

        const files = fs.readdirSync(reportsDir)
          .filter(f => f.endsWith(".json"))
          .sort()
          .reverse();

        if (files.length === 0) {
          console.log("No reports found");
          break;
        }

        const latestFile = files[0];
        const content = fs.readFileSync(path.join(reportsDir, latestFile), "utf8");
        const parsed = JSON.parse(content);
        outputJson(parsed, !jsonOutput);
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown report command: ${subcommand}`);
      process.exit(1);
  }
}

async function handleCaptcha(args: ParsedArgs): Promise<void> {
  const { subcommand, flags } = args;
  const jsonOutput = flags.json === "true";

  if (subcommand !== "test") {
    console.error(`Unknown captcha command: ${subcommand}`);
    process.exit(1);
  }

  // Captcha solving requires a browser Page which the CLI cannot provide.
  // Validate configuration instead of pretending to solve.
  const config = loadConfig({ validate: false });
  if (!config.captchaProvider) {
    console.error("Error: CAPTCHA_PROVIDER is not configured. Set it in .env to enable captcha solving.");
    process.exit(1);
  }
  if (!config.captchaApiKey) {
    console.error("Error: CAPTCHA_API_KEY is not configured.");
    process.exit(1);
  }

  const result = {
    provider: config.captchaProvider,
    timeoutMs: config.captchaTimeoutMs,
    status: "configured",
    note: "Captcha solving requires a browser page context. Use the programmatic API or daemon to solve captchas at runtime.",
  };
  outputJson(result, !jsonOutput);
}

async function handlePolicy(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const { 
    listBuiltInProfiles, 
    listCustomProfiles, 
    getAllProfiles,
    getProfile, 
    serializeProfile, 
    deserializeProfile, 
    validateProfile,
    saveCustomProfile 
  } = await import("./policy/profiles");

  switch (subcommand) {
    case "list": {
      const builtIn = listBuiltInProfiles();
      const custom = listCustomProfiles();
      const result = {
        builtIn: builtIn.map(p => p.name),
        custom: custom.map(p => p.name),
      };
      outputJson(result, !jsonOutput);
      break;
    }

    case "inspect": {
      const name = positional[0];
      if (!name) {
        console.error("Error: Profile name is required");
        process.exit(1);
      }
      const profile = getProfile(name);
      if (!profile) {
        console.error(`Error: Profile "${name}" not found`);
        process.exit(1);
      }
      outputJson(profile, !jsonOutput);
      break;
    }

    case "export": {
      const name = positional[0];
      if (!name) {
        console.error("Error: Profile name is required");
        process.exit(1);
      }
      const profile = getProfile(name);
      if (!profile) {
        console.error(`Error: Profile "${name}" not found`);
        process.exit(1);
      }

      const outputPath = positional[1] || `${name}-policy.json`;
      const serialized = serializeProfile(profile);
      fs.writeFileSync(outputPath, serialized, "utf-8");
      console.log(`Profile exported to: ${outputPath}`);
      break;
    }

    case "import": {
      const filePath = positional[0];
      if (!filePath) {
        console.error("Error: File path is required");
        process.exit(1);
      }

      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const profile = deserializeProfile(content);
      if (!profile) {
        console.error("Error: Failed to parse profile or validation failed");
        process.exit(1);
      }

      const validation = validateProfile(profile);
      if (!validation.valid) {
        console.error("Validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      saveCustomProfile(profile);
      outputJson(profile, !jsonOutput);
      console.log(`Profile "${profile.name}" imported and saved successfully`);
      break;
    }

    default:
      console.error(`Unknown policy command: ${subcommand}`);
      process.exit(1);
  }
}

async function handleBrowser(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "attach": {
      const port = flags.port ? Number(flags.port) : undefined;
      const cdpUrl = flags["cdp-url"] ?? undefined;
      const targetType = (flags["target-type"] ?? "chrome") as "chrome" | "chromium" | "electron";
      const provider = flags.provider ?? undefined;

      try {
        const { BrowserConnectionManager } = await import("./browser/connection");
        const { loadConfig } = await import("./shared/config");
        const { DefaultPolicyEngine } = await import("./policy/engine");
        
        const config = loadConfig({ validate: false });
        const policyEngine = new DefaultPolicyEngine({ profileName: config.policyProfile });
        const manager = new BrowserConnectionManager({ policyEngine });

        const connection = await manager.attach({
          port,
          cdpUrl,
          targetType,
          actor: "human",
          provider,
        });
        if (jsonOutput) {
          outputJson(connection);
        } else {
          console.log(`Attached to ${connection.targetType} browser`);
          console.log(`  Mode:     ${connection.mode}`);
          console.log(`  Endpoint: ${connection.cdpEndpoint}`);
          console.log(`  Tabs:     ${connection.tabCount}`);
          console.log(`  Status:   ${connection.status}`);
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "launch": {
      const port = flags.port ? Number(flags.port) : undefined;
      const profileName = flags.profile ?? "default";
      const provider = flags.provider ?? undefined;

      try {
        const { BrowserConnectionManager } = await import("./browser/connection");
        const { loadConfig } = await import("./shared/config");
        const { DefaultPolicyEngine } = await import("./policy/engine");

        const config = loadConfig({ validate: false });
        const policyEngine = new DefaultPolicyEngine({ profileName: config.policyProfile });
        const manager = new BrowserConnectionManager({ policyEngine });

        const connection = await manager.launchManaged({
          port,
          profileName,
          actor: "human",
          provider,
        });
        if (jsonOutput) {
          outputJson(connection);
        } else {
          console.log(`Managed browser connected`);
          console.log(`  Mode:     ${connection.mode}`);
          console.log(`  Profile:  ${connection.profile.name} (${connection.profile.type})`);
          console.log(`  Endpoint: ${connection.cdpEndpoint}`);
          console.log(`  Tabs:     ${connection.tabCount}`);
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "status": {
      try {
        const store = new MemoryStore();
        const connectionState = store.get("browser_connection:active");
        store.close();
        if (!connectionState) {
          console.log(jsonOutput ? '{"connected":false}' : "No active browser connection.");
        } else {
          outputJson(connectionState, !jsonOutput);
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "provider": {
      const providerAction = positional[0];
      switch (providerAction) {
        case "list": {
          const { ProviderRegistry } = await import("./providers/registry");
          const registry = new ProviderRegistry();
          const result = registry.list();
          if (jsonOutput) {
            outputJson(result);
          } else {
            console.log(`Active provider: ${result.activeProvider}`);
            console.log("Built-in providers:");
            for (const name of result.builtIn) {
              const marker = name === result.activeProvider ? " (active)" : "";
              console.log(`  ${name}${marker}`);
            }
            if (result.providers.length > 0) {
              console.log("Custom providers:");
              for (const p of result.providers) {
                const marker = p.name === result.activeProvider ? " (active)" : "";
                console.log(`  ${p.name} (${p.type})${marker}`);
              }
            }
          }
          break;
        }
        case "use": {
          const name = positional[1];
          if (!name) {
            console.error("Error: Provider name is required");
            process.exit(1);
          }
          requireCliPolicy("browser_provider_use", { name }, jsonOutput);
          const { ProviderRegistry } = await import("./providers/registry");
          const registry = new ProviderRegistry();
          const result = registry.select(name);
          if (jsonOutput) {
            outputJson(result);
          } else {
            if (result.success) {
              console.log(`Active provider set to "${name}"`);
              if (result.previousProvider && result.previousProvider !== name) {
                console.log(`  (was: ${result.previousProvider})`);
              }
            } else {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
          }
          break;
        }
        case "add": {
          const name = positional[1];
          if (!name) {
            console.error("Error: Provider name is required");
            process.exit(1);
          }
          const providerType = flags.type as string | undefined;
          const endpoint = flags.endpoint as string | undefined;
          const apiKey = flags["api-key"] as string | undefined;
          if (!providerType) {
            console.error("Error: --type is required (browserless, custom)");
            process.exit(1);
          }
          if (providerType !== "browserless" && providerType !== "custom") {
            console.error(`Error: Invalid provider type "${providerType}". Must be browserless or custom.`);
            process.exit(1);
          }
          if (!endpoint) {
            console.error("Error: --endpoint is required");
            process.exit(1);
          }
          requireCliPolicy("browser_provider_add", { name, type: providerType, endpoint }, jsonOutput);
          const { ProviderRegistry } = await import("./providers/registry");
          const registry = new ProviderRegistry();
          const config: Record<string, unknown> = { name, type: providerType, endpoint };
          if (apiKey) config.apiKey = apiKey;
          const result = registry.add(config as any);
          if (jsonOutput) {
            outputJson(result);
          } else {
            if (result.success) {
              console.log(`Provider "${name}" added (${providerType})`);
              if (apiKey) console.log("  API key stored (not shown)");
            } else {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
          }
          break;
        }
        case "remove": {
          const name = positional[1];
          if (!name) {
            console.error("Error: Provider name is required");
            process.exit(1);
          }
          requireCliPolicy("browser_provider_remove", { name }, jsonOutput);
          const { ProviderRegistry } = await import("./providers/registry");
          const registry = new ProviderRegistry();
          const result = registry.remove(name);
          if (jsonOutput) {
            outputJson(result);
          } else {
            if (result.success) {
              console.log(`Provider "${name}" removed`);
            } else {
              console.error(`Error: ${result.error}`);
              process.exit(1);
            }
          }
          break;
        }
        default:
          console.error(`Unknown browser provider command: ${providerAction}`);
          console.error("Available: list, use, add, remove");
          process.exit(1);
      }
      break;
    }

    case "profile": {
      // Nested subcommand: args.positional[0] = profile action, positional[1+] = args
      const profileAction = positional[0];

      switch (profileAction) {
        case "list": {
          const { BrowserProfileManager } = await import("./browser/profiles");
          const pm = new BrowserProfileManager();
          const profiles = pm.listProfiles();
          if (jsonOutput) {
            outputJson(profiles, false);
          } else {
            if (profiles.length === 0) {
              console.log("No profiles.");
            } else {
              for (const p of profiles) {
                const marker = p.type === "shared" ? " (shared)" : p.type === "isolated" ? " (isolated)" : "";
                console.log(`  ${p.name}${marker} — last used: ${p.lastUsedAt}`);
              }
            }
          }
          break;
        }

        case "create": {
          const name = positional[1];
          if (!name) {
            console.error("Error: Profile name is required");
            process.exit(1);
          }
          const type = (flags.type ?? "named") as "shared" | "isolated" | "named";
          const { BrowserProfileManager } = await import("./browser/profiles");
          const pm = new BrowserProfileManager();
          const profile = pm.createProfile(name, type);
          if (jsonOutput) {
            outputJson(profile, false);
          } else {
            console.log(`Profile "${profile.name}" created (type: ${profile.type})`);
            console.log(`  Data dir: ${profile.dataDir}`);
          }
          break;
        }

        case "use": {
          const name = positional[1];
          if (!name) {
            console.error("Error: Profile name is required");
            process.exit(1);
          }
          const { BrowserProfileManager } = await import("./browser/profiles");
          const pm = new BrowserProfileManager();
          const profile = pm.getProfileByName(name);
          if (!profile) {
            console.error(`Error: Profile "${name}" not found`);
            process.exit(1);
          }
          pm.touchProfile(profile.id);
          // Store the active profile preference
          const store = new MemoryStore();
          store.set("browser_connection:active_profile", { id: profile.id, name: profile.name });
          store.close();
          if (jsonOutput) {
            outputJson(profile, false);
          } else {
            console.log(`Active profile set to "${profile.name}" (${profile.type})`);
          }
          break;
        }

        case "delete": {
          const name = positional[1];
          if (!name) {
            console.error("Error: Profile name is required");
            process.exit(1);
          }
          const { BrowserProfileManager } = await import("./browser/profiles");
          const pm = new BrowserProfileManager();
          const deleted = pm.deleteProfileByName(name);
          if (!deleted) {
            console.error(`Error: Profile "${name}" not found or cannot be deleted`);
            process.exit(1);
          }
          console.log(`Profile "${name}" deleted.`);
          break;
        }

        default:
          console.error(`Unknown browser profile command: ${profileAction}`);
          console.error("Available: list, create, use, delete");
          process.exit(1);
      }
      break;
    }

    case "auth": {
      const authAction = positional[0];

      switch (authAction) {
        case "export": {
          const profileName = flags.profile;
          const outputFile = positional[1] ?? `${profileName ?? "default"}-auth.json`;
          const isLive = Boolean(flags.live);
          const isStored = Boolean(flags.stored);

          if (!isLive && !isStored) {
             console.error("Error: You must specify either --live (to extract from the active browser) or --stored (to extract from offline memory snapshot).");
             process.exit(1);
          }
          if (isLive && isStored) {
             console.error("Error: Cannot specify both --live and --stored.");
             process.exit(1);
          }

          requireCliPolicy("browser_auth_export", {
            profileName: profileName ?? "default",
            outputFile,
            live: isLive,
            stored: isStored,
          }, jsonOutput);

          try {
            const { BrowserProfileManager } = await import("./browser/profiles");
            const { BrowserConnectionManager } = await import("./browser/connection");
            const { loadAuthSnapshot } = await import("./browser/auth_state");
            const { loadConfig } = await import("./shared/config");
            const { DefaultPolicyEngine } = await import("./policy/engine");

            const config = loadConfig({ validate: false });
            const policyEngine = new DefaultPolicyEngine({ profileName: config.policyProfile });
            const manager = new BrowserConnectionManager({ policyEngine });
            const pm = new BrowserProfileManager();
            const store = new MemoryStore();
            const activeSession = store.get<Record<string, any>>("browser_connection:active");
            
            let snapshot = null;

            if (isLive) {
              if (!activeSession || activeSession.status !== "connected") {
                 store.close();
                 console.error("Error: --live was specified but no active browser is currently connected.");
                 process.exit(1);
              }
              const activeProfileId = activeSession.profileId;
              const activeProfileName = pm.getProfile(activeProfileId)?.name;
              
              if (profileName && profileName !== activeProfileName) {
                 store.close();
                 console.error(`Error: Active browser is running profile "${activeProfileName}", but you requested "${profileName}".`);
                 process.exit(1);
              }

              let activePort = config.chromeDebugPort;
              if (activeSession.cdpEndpoint && activeSession.cdpEndpoint.includes(":")) {
                const url = new URL(activeSession.cdpEndpoint);
                activePort = parseInt(url.port, 10);
              }

              console.log(`Connecting to active browser for profile "${activeProfileName}" on port ${activePort}...`);
              await manager.attach({ port: activePort, targetType: activeSession.targetType, actor: "human" });
              snapshot = await manager.exportAuth();
              await manager.disconnect();
              console.log(`Successfully extracted live auth state from running browser.`);
            } else {
              const targetProfileName = profileName ?? "default";
              const profile = pm.getProfileByName(targetProfileName);
              if (!profile) {
                store.close();
                console.error(`Error: Profile "${targetProfileName}" not found`);
                process.exit(1);
              }
              snapshot = loadAuthSnapshot(store, profile.id);
              if (!snapshot) {
                store.close();
                console.error(`No saved auth state for profile "${targetProfileName}".`);
                console.error("Connect to a browser first and let cookies persist, then try again.");
                process.exit(1);
              }
              console.log(`Successfully loaded stored auth snapshot for profile "${targetProfileName}".`);
            }

            store.close();
            fs.writeFileSync(outputFile, JSON.stringify(snapshot, null, 2));
            console.log(`Auth state saved to: ${outputFile}`);
            console.log(`  Cookies: ${snapshot.cookies.length}`);
            console.log(`  localStorage domains: ${Object.keys(snapshot.localStorage).length}`);
          } catch (error) {
            console.error("Error:", (error as Error).message);
            process.exit(1);
          }
          break;
        }

        case "import": {
          const filePath = positional[1];
          const isLive = Boolean(flags.live);
          const isStored = Boolean(flags.stored);

          if (!filePath) {
             console.error("Error: File path is required");
             process.exit(1);
          }
          if (!fs.existsSync(filePath)) {
             console.error(`Error: File not found: ${filePath}`);
             process.exit(1);
          }
          if (!isLive && !isStored) {
             console.error("Error: You must specify either --live (to inject into the active browser) or --stored (to update offline memory snapshot).");
             process.exit(1);
          }
          if (isLive && isStored) {
             console.error("Error: Cannot specify both --live and --stored.");
             process.exit(1);
          }

          requireCliPolicy("browser_auth_import", {
            filePath,
            live: isLive,
            stored: isStored,
          }, jsonOutput);

          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const snapshot = JSON.parse(content);
            const { BrowserConnectionManager } = await import("./browser/connection");
            const { saveAuthSnapshotToStore } = await import("./browser/auth_state");
            const { loadConfig } = await import("./shared/config");
            const { DefaultPolicyEngine } = await import("./policy/engine");

            const config = loadConfig({ validate: false });
            const policyEngine = new DefaultPolicyEngine({ profileName: config.policyProfile });
            const manager = new BrowserConnectionManager({ policyEngine });
            const profileId = snapshot.profileId ?? "default";
            
            const store = new MemoryStore();

            if (isLive) {
              const activeSession = store.get<Record<string, any>>("browser_connection:active");
              if (!activeSession || activeSession.status !== "connected") {
                 store.close();
                 console.error("Error: --live was specified but no active browser is currently connected.");
                 process.exit(1);
              }
              if (activeSession.profileId !== profileId) {
                 store.close();
                 console.error(`Error: Active browser is running profile "${activeSession.profileId}", but snapshot is for "${profileId}".`);
                 process.exit(1);
              }

              let activePort = config.chromeDebugPort;
              if (activeSession.cdpEndpoint && activeSession.cdpEndpoint.includes(":")) {
                const url = new URL(activeSession.cdpEndpoint);
                activePort = parseInt(url.port, 10);
              }

              console.log(`Connecting to active browser for profile "${profileId}" on port ${activePort}...`);
              await manager.attach({ port: activePort, targetType: activeSession.targetType, actor: "human" });
              await manager.importAuth(snapshot);
              await manager.disconnect();
              console.log(`Successfully injected auth state directly into live running browser context.`);
            } else {
              // Store only
              saveAuthSnapshotToStore(store, profileId, snapshot);
              console.log(`Stored offline auth snapshot updated for profile "${profileId}".`);
              console.log(`  (Note: The browser was not affected. This will apply next time the profile is launched as a restored session.)`);
            }

            store.close();
            console.log(`  Cookies: ${snapshot.cookies?.length ?? 0}`);
          } catch (error) {
            console.error("Error:", (error as Error).message);
            process.exit(1);
          }
          break;
        }

        default:
          console.error(`Unknown browser auth command: ${authAction}`);
          console.error("Available: export, import");
          process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown browser command: ${subcommand}`);
      console.error("Available: attach, launch, status, profile, auth");
      process.exit(1);
  }
}

export async function runCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv);

  if (args.flags.help || args.flags.h || args.command === "help") {
    printHelp();
    return;
  }

  if (!args.command) {
    printHelp();
    return;
  }

  const previousJsonOutputMode = process.env.BROWSER_CONTROL_JSON_OUTPUT;
  if (args.flags.json === "true") {
    process.env.BROWSER_CONTROL_JSON_OUTPUT = "true";
  }

  switch (args.command) {
    case "doctor":
      await handleDoctor(args);
      break;

    case "setup":
      await handleSetup(args);
      break;

    case "config":
      await handleConfig(args);
      break;

    case "status":
      await handleStatus(args);
      break;

    case "run":
      await handleRun(args);
      break;

    case "schedule":
      await handleSchedule(args);
      break;

    case "daemon":
      await handleDaemon(args);
      break;

    case "proxy":
      await handleProxy(args);
      break;

    case "memory":
      await handleMemory(args);
      break;

    case "skill":
      await handleSkill(args);
      break;

    case "report":
      await handleReport(args);
      break;

    case "captcha":
      await handleCaptcha(args);
      break;

    case "policy":
      await handlePolicy(args);
      break;

    // ── Top-level browser actions (Section 5) ─────────────────────
    case "open":
      await handleBrowserAction("open", args);
      break;

    case "snapshot":
      await handleBrowserAction("snapshot", args);
      break;

    case "click":
      await handleBrowserAction("click", args);
      break;

    case "fill":
      await handleBrowserAction("fill", args);
      break;

    case "hover":
      await handleBrowserAction("hover", args);
      break;

    case "type":
      await handleBrowserAction("type", args);
      break;

    case "press":
      await handleBrowserAction("press", args);
      break;

    case "scroll":
      await handleBrowserAction("scroll", args);
      break;

    case "screenshot":
      await handleBrowserAction("screenshot", args);
      break;

    case "tab":
      await handleBrowserAction("tab", args);
      break;

    case "close":
      await handleBrowserAction("close", args);
      break;

    // ── Session commands (Section 5) ────────────────────────────────
    case "session":
      await handleSession(args);
      break;

    case "browser":
      await handleBrowser(args);
      break;

    case "knowledge":
      await handleKnowledge(args);
      break;

    case "term":
      await handleTerm(args);
      break;

    case "fs":
      await handleFs(args);
      break;

    case "service":
      await handleService(args);
      break;

    case "debug":
      await handleDebug(args);
      break;

    // ── MCP Server (Section 7) ──────────────────────────────────────
    case "mcp":
      await handleMcp(args);
      break;

    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(1);
  }

  // ── Clean exit ──────────────────────────────────────────────────
  // Close the shared SessionManager to release all held resources
  // (MemoryStore's SQLite handle, terminal manager, etc.). Without
  // this, the Node.js event loop stays alive and the CLI process
  // never exits after commands like `bc term open --json`.
  if (_sessionManager) {
    _sessionManager.close();
  }

  if (previousJsonOutputMode === undefined) {
    delete process.env.BROWSER_CONTROL_JSON_OUTPUT;
  } else {
    process.env.BROWSER_CONTROL_JSON_OUTPUT = previousJsonOutputMode;
  }
}

// ── Knowledge Handler (Section 9) ──────────────────────────────────

async function handleKnowledge(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const {
    listAllKnowledge,
    listByKind,
    findByDomain,
    findByName,
    deleteArtifact,
    pruneArtifact,
    loadArtifact,
  } = await import("./knowledge/store");
  const {
    getKnowledgeStats,
  } = await import("./knowledge/query");
  const { validateArtifact } = await import("./knowledge/validator");

  switch (subcommand) {
    case "list": {
      const kindFilter = flags.kind as string | undefined;
      let summaries = kindFilter
        ? listByKind(kindFilter as any)
        : listAllKnowledge();

      if (jsonOutput) {
        outputJson(summaries, false);
      } else {
        if (summaries.length === 0) {
          console.log("No knowledge artifacts found.");
          break;
        }
        console.log(`Knowledge artifacts (${summaries.length}):\n`);
        for (const s of summaries) {
          const verified = s.verified ? " [verified]" : "";
          const tags = s.tags.length > 0 ? ` tags=[${s.tags.join(", ")}]` : "";
          console.log(`  ${s.kind.padEnd(18)} ${s.identifier.padEnd(30)} ${s.entryCount} entries${verified}${tags}`);
        }
        const stats = getKnowledgeStats();
        console.log(`\nTotal: ${stats.totalFiles} files, ${stats.totalEntries} entries (${stats.verifiedEntries} verified)`);
      }
      break;
    }

    case "show": {
      const nameOrDomain = positional[0];
      if (!nameOrDomain) {
        console.error("Error: Name or domain is required");
        process.exit(1);
      }

      let artifact = findByDomain(nameOrDomain);
      if (!artifact) artifact = findByName(nameOrDomain);

      if (!artifact) {
        console.error(`Error: No knowledge found for "${nameOrDomain}"`);
        process.exit(1);
      }

      if (jsonOutput) {
        outputJson({
          frontmatter: artifact.frontmatter,
          entries: artifact.entries,
          sections: Object.keys(artifact.sections),
        }, true);
      } else {
        console.log(`Kind:       ${artifact.frontmatter.kind}`);
        if (artifact.frontmatter.domain) console.log(`Domain:     ${artifact.frontmatter.domain}`);
        if (artifact.frontmatter.name) console.log(`Name:       ${artifact.frontmatter.name}`);
        console.log(`Captured:   ${artifact.frontmatter.capturedAt}`);
        if (artifact.frontmatter.updatedAt) console.log(`Updated:    ${artifact.frontmatter.updatedAt}`);
        console.log(`Verified:   ${artifact.frontmatter.verified ?? false}`);
        console.log(`Entries:    ${artifact.entries.length}`);
        console.log(`File:       ${artifact.filePath}`);

        if (artifact.entries.length > 0) {
          console.log(`\nEntries:`);
          for (const entry of artifact.entries) {
            const verifiedTag = entry.verified ? " [verified]" : "";
            console.log(`  [${entry.type}] ${entry.description}${verifiedTag}`);
            if (entry.selector) console.log(`    selector: ${entry.selector}`);
            if (entry.waitCondition) console.log(`    waitCondition: ${entry.waitCondition} (${entry.waitMs ?? "?"}ms)`);
          }
        }

        console.log(`\nBody preview:`);
        const preview = artifact.body.split("\n").slice(0, 20).join("\n");
        console.log(preview);
        if (artifact.body.split("\n").length > 20) {
          console.log("... (truncated)");
        }
      }
      break;
    }

    case "validate": {
      const all = listAllKnowledge();
      if (all.length === 0) {
        console.log("No knowledge artifacts to validate.");
        break;
      }

      let allValid = true;
      const results: any[] = [];

      for (const summary of all) {
        const artifact = loadArtifact(summary.filePath);
        if (!artifact) continue;

        const result = validateArtifact(artifact);
        results.push(result);

        if (!result.valid) allValid = false;

        if (!jsonOutput) {
          const status = result.valid ? "VALID" : "INVALID";
          const issueCount = result.issues.length;
          console.log(`  ${status.padEnd(8)} ${summary.identifier.padEnd(30)} ${issueCount} issue(s)`);
          for (const issue of result.issues) {
            const prefix = issue.severity === "error" ? "  ERROR" : "  WARN ";
            const line = issue.line ? ` (line ${issue.line})` : "";
            console.log(`    ${prefix}: ${issue.message}${line}`);
          }
        }
      }

      if (jsonOutput) {
        outputJson(results, true);
      } else {
        console.log(`\n${allValid ? "All valid." : "Some files have issues."}`);
      }

      if (!allValid) process.exit(1);
      break;
    }

    case "prune": {
      // Prune removes stale entries (not full delete)
      const nameOrDomain = positional[0];
      if (!nameOrDomain) {
        console.error("Error: Name or domain is required");
        process.exit(1);
      }

      let artifact = findByDomain(nameOrDomain);
      if (!artifact) artifact = findByName(nameOrDomain);

      if (!artifact) {
        console.error(`Error: No knowledge found for "${nameOrDomain}"`);
        process.exit(1);
      }

      const result = pruneArtifact(artifact.filePath, {
        maxAgeDays: 90,
        removeUnverified: false,
        removeFailed: true,
      });

      if (jsonOutput) {
        outputJson(result);
      } else {
        console.log(`Pruned ${result.removed} entries from ${result.kept} retained.`);
        if (result.removed > 0) {
          console.log(`Updated: ${artifact.filePath}`);
        }
      }
      break;
    }

    case "delete": {
      // Full file delete (separate from prune)
      const nameOrDomain = positional[0];
      if (!nameOrDomain) {
        console.error("Error: Name or domain is required");
        process.exit(1);
      }

      let artifact = findByDomain(nameOrDomain);
      if (!artifact) artifact = findByName(nameOrDomain);

      if (!artifact) {
        console.error(`Error: No knowledge found for "${nameOrDomain}"`);
        process.exit(1);
      }

      const deleted = deleteArtifact(artifact.filePath);
      if (deleted) {
        console.log(`Deleted: ${artifact.filePath}`);
      } else {
        console.error(`Error: Failed to delete ${artifact.filePath}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown knowledge command: ${subcommand}`);
      console.error("Supported: list, show, validate, prune, delete");
      process.exit(1);
  }
}

// ── MCP Handler (Section 7) ───────────────────────────────────────────

async function handleMcp(args: ParsedArgs): Promise<void> {
  const { subcommand } = args;

  switch (subcommand) {
    case "serve": {
      const { startMcpServer } = await import("./mcp/server");
      await startMcpServer();
      break;
    }

    default:
      console.error(`Unknown MCP command: ${subcommand}`);
      console.error("Available: serve");
      process.exit(1);
  }
}

// ── Section 5 shared session manager singleton ────────────────────────

let _sessionManager: import("./session_manager").SessionManager | null = null;

/**
 * Ensure the daemon is running and reachable for terminal session commands.
 *
 * Delegates to SessionManager.ensureDaemonRuntime({ autoStart: true }), which
 * probes the daemon health endpoint and, if it's not running, auto-starts it
 * with retries.  This is the unified path used by both CLI and API.
 *
 * On success, returns the broker URL.  On failure, throws an error.
 */
async function ensureDaemonRunning(): Promise<string> {
  // Use or create the session manager singleton
  if (!_sessionManager) {
    const { SessionManager } = await import("./session_manager");
    _sessionManager = new SessionManager();
  }

  const established = await _sessionManager.ensureDaemonRuntime({ autoStart: true });
  if (!established) {
    throw new Error(
      `Failed to start or connect to the daemon for terminal session commands. ` +
      `Try manually: bc daemon start`,
    );
  }

  // Return the broker URL from the cached runtime
  const config = loadConfig({ validate: false });
  return `http://127.0.0.1:${config.brokerPort}`;
}

// ── Terminal Handlers (Section 5 — routed through action surface) ────

/**
 * Terminal subcommands that require a running daemon because they
 * manage persistent terminal sessions that must survive across
 * separate CLI invocations.
 */
const DAEMON_REQUIRED_TERM_COMMANDS = new Set([
  "open", "type", "read", "snapshot", "interrupt", "close", "list", "resume", "status",
]);

export async function handleTerm(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const { SessionManager } = await import("./session_manager");
  const { TerminalActions } = await import("./terminal/actions");
  const { formatActionResult } = await import("./shared/action_result");

  // ── Terminal ownership model ──────────────────────────────────────
  // Terminal sessions must be owned by the long-lived daemon, NOT by
  // the short-lived CLI process.  This is the fix for the Section 5
  // terminal ownership defect:
  //
  //   - When the daemon is running, CLI term commands route through
  //     BrokerTerminalRuntime (HTTP to daemon's broker API).
  //     The PTY lives in the daemon process, so the CLI exits cleanly.
  //
  //   - When the daemon is NOT running, session-dependent commands
  //     (open, type, read, etc.) return an error telling the user to
  //     start the daemon first.  One-shot "term exec" (no --session)
  //     still works locally because it doesn't create persistent PTYs.

  const needsDaemon = DAEMON_REQUIRED_TERM_COMMANDS.has(subcommand ?? "")
    || (subcommand === "exec" && Boolean(flags.session));

  if (needsDaemon) {
    // ── Terminal ownership model (Section 5 fix) ─────────────────
    // Terminal sessions must be owned by the long-lived daemon, NOT
    // by the short-lived CLI process.  If the daemon isn't running,
    // auto-start it transparently so `bc term open` works without
    // the user needing to know about `bc daemon start`.
    //
    // The PTY lives in the daemon process; the CLI routes through
    // the SessionManager's broker-backed runtime (HTTP to daemon's
    // broker API), so the CLI exits cleanly after printing the result.
    //
    // ensureDaemonRunning() calls SessionManager.ensureDaemonRuntime({ autoStart: true }),
    // which probes the daemon health endpoint, auto-starts the daemon
    // if needed, and caches a BrokerTerminalRuntime on the SessionManager.
    // After this, _sessionManager.getTerminalRuntime() returns the
    // BrokerTerminalRuntime automatically.

    try {
      await ensureDaemonRunning();
    } catch (error) {
      const message = (error as Error).message ??
        `Failed to start the daemon for terminal session commands.`;
      if (jsonOutput) {
        outputJson({
          success: false,
          error: message,
          completedAt: new Date().toISOString(),
        }, false);
      } else {
        console.error(`Error: ${message}`);
      }
      process.exit(1);
      return; // unreachable but helps type inference
    }
  }

  // Use or create a session manager singleton (same as browser actions).
  // After ensureDaemonRunning(), getTerminalRuntime() will return
  // the cached BrokerTerminalRuntime for daemon-backed sessions.
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }

  const terminalActions = new TerminalActions({
    sessionManager: _sessionManager,
    // No explicit terminalRuntime needed — TerminalActions uses
    // sessionManager.getTerminalRuntime() which returns the correct
    // runtime (BrokerTerminalRuntime when daemon is running, or
    // LocalTerminalRuntime for one-shot exec).
  });

  try {
    let result: import("./shared/action_result").ActionResult | undefined;

    switch (subcommand) {
      case "open": {
        result = await terminalActions.open({
          shell: flags.shell,
          cwd: flags.cwd,
          name: flags.name,
        });
        break;
      }

      case "exec": {
        const command = positional[0];
        if (!command) {
          console.error("Error: Command is required");
          process.exit(1);
        }
        result = await terminalActions.exec({
          command,
          sessionId: flags.session,
          timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
        });
        break;
      }

      case "type": {
        const text = positional[0];
        const sessionId = flags.session;
        if (!text) {
          console.error("Error: Text is required");
          process.exit(1);
        }
        if (!sessionId) {
          console.error("Error: --session is required for 'term type'");
          process.exit(1);
        }
        result = await terminalActions.type({ text, sessionId });
        break;
      }

      case "read": {
        const sessionId = flags.session;
        if (!sessionId) {
          console.error("Error: --session is required for 'term read'");
          process.exit(1);
        }
        result = await terminalActions.read({ sessionId, maxBytes: flags["max-bytes"] ? Number(flags["max-bytes"]) : undefined });
        break;
      }

      case "snapshot": {
        const sessionId = flags.session;
        result = await terminalActions.snapshot({ sessionId });
        break;
      }

      case "interrupt": {
        const sessionId = flags.session;
        if (!sessionId) {
          console.error("Error: --session is required for 'term interrupt'");
          process.exit(1);
        }
        result = await terminalActions.interrupt({ sessionId });
        break;
      }

      case "close": {
        const sessionId = flags.session;
        if (!sessionId) {
          console.error("Error: --session is required for 'term close'");
          process.exit(1);
        }
        result = await terminalActions.close({ sessionId });
        break;
      }

      case "list": {
        result = await terminalActions.list();
        break;
      }

      case "resume": {
        const sessionId = positional[0] || flags.session;
        if (!sessionId) {
          console.error("Error: session ID is required for 'term resume'");
          process.exit(1);
        }
        result = await terminalActions.resume({ sessionId });
        break;
      }

      case "status": {
        const sessionId = positional[0] || flags.session;
        if (!sessionId) {
          console.error("Error: session ID is required for 'term status'");
          process.exit(1);
        }
        result = await terminalActions.status({ sessionId });
        break;
      }

      default:
        console.error(`Unknown term command: ${subcommand}`);
        process.exit(1);
    }

    if (result) {
      if (jsonOutput) {
        outputJson(formatActionResult(result), false);
      } else {
        if (result.success) {
          // Human-friendly output per action type
          if (subcommand === "exec" && result.data) {
            const execData = result.data as import("./terminal/types").ExecResult;
            console.log(execData.stdout ?? "");
            if (execData.exitCode !== 0 && execData.stderr) {
              console.error(execData.stderr);
            }
          } else if (subcommand === "read" && result.data) {
            const readData = result.data as { output: string };
            console.log(readData.output);
          } else if (subcommand === "list" && result.data) {
            const sessions = result.data as Array<{ id: string; name?: string; shell: string; cwd: string; status: string; resumeMetadata?: { restored?: boolean; resumeLevel?: number; status?: string } }>;
            for (const s of sessions) {
              const resumeTag = s.resumeMetadata?.restored
                ? ` [${s.resumeMetadata.status ?? "resumed"} L${s.resumeMetadata.resumeLevel ?? 1}]`
                : "";
              console.log(`  ${s.id}  ${s.shell}  ${s.cwd}  ${s.status}${resumeTag}`);
            }
            console.log(`\n${sessions.length} session(s)`);
          } else if ((subcommand === "resume" || subcommand === "status") && result.data) {
            const resumeData = result.data as { sessionId: string; status: string; resumeLevel: number; preserved: { metadata: boolean; buffer: boolean }; lost: string[] };
            console.log(`Session: ${resumeData.sessionId}`);
            console.log(`Status:  ${resumeData.status}`);
            console.log(`Level:   ${resumeData.resumeLevel}`);
            console.log(`Preserved: metadata=${resumeData.preserved.metadata}, buffer=${resumeData.preserved.buffer}`);
            if (resumeData.lost.length > 0) {
              console.log(`Lost:    ${resumeData.lost.join(", ")}`);
            }
          } else {
            outputJson(result.data, true);
          }
          if (result.warning) console.warn(`Warning: ${result.warning}`);
        } else {
          console.error(`Error: ${result.error}`);
          if (result.policyDecision) console.error(`Policy: ${result.policyDecision}`);
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

// ── FS Handlers (Section 5 — routed through action surface) ──────────

export async function handleFs(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const { SessionManager } = await import("./session_manager");
  const { FsActions } = await import("./filesystem/actions");
  const { formatActionResult } = await import("./shared/action_result");

  // Use or create a session manager singleton (same as browser/term actions)
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }

  const fsActions = new FsActions({ sessionManager: _sessionManager });

  try {
    let result: import("./shared/action_result").ActionResult | undefined;

    switch (subcommand) {
      case "read": {
        const filePath = positional[0];
        if (!filePath) {
          console.error("Error: File path is required");
          process.exit(1);
        }
        result = await fsActions.read({
          path: filePath,
          maxBytes: flags["max-bytes"] ? Number(flags["max-bytes"]) : undefined,
        });
        break;
      }

      case "write": {
        const filePath = positional[0];
        if (!filePath) {
          console.error("Error: File path is required");
          process.exit(1);
        }
        result = await fsActions.write({
          path: filePath,
          content: flags.content ?? "",
          createDirs: flags["create-dirs"] !== "false",
        });
        break;
      }

      case "ls": {
        const dirPath = positional[0] ?? ".";
        result = await fsActions.ls({
          path: dirPath,
          recursive: flags.recursive === "true",
          extension: flags.ext,
        });
        break;
      }

      case "move": {
        const src = positional[0];
        const dst = positional[1];
        if (!src || !dst) {
          console.error("Error: Source and destination paths are required");
          process.exit(1);
        }
        result = await fsActions.move({ src, dst });
        break;
      }

      case "rm": {
        const targetPath = positional[0];
        if (!targetPath) {
          console.error("Error: Path is required");
          process.exit(1);
        }
        result = await fsActions.rm({
          path: targetPath,
          recursive: flags.recursive === "true",
          force: flags.force === "true",
        });
        break;
      }

      case "stat": {
        const targetPath = positional[0];
        if (!targetPath) {
          console.error("Error: Path is required");
          process.exit(1);
        }
        result = await fsActions.stat({ path: targetPath });
        break;
      }

      default:
        console.error(`Unknown fs command: ${subcommand}`);
        process.exit(1);
    }

    if (result) {
      if (jsonOutput) {
        outputJson(formatActionResult(result), false);
      } else {
        if (result.success) {
          // Human-friendly output per action type
          if (subcommand === "read" && result.data) {
            const readData = result.data as import("./filesystem/operations").FileReadResult;
            console.log(readData.content);
          } else if (subcommand === "ls" && result.data) {
            const listData = result.data as import("./filesystem/operations").ListResult;
            for (const entry of listData.entries) {
              const typeChar = entry.type === "directory" ? "d" : entry.type === "symlink" ? "l" : "-";
              const size = entry.sizeBytes.toString().padStart(10);
              console.log(`${typeChar} ${size}  ${entry.name}`);
            }
            console.log(`\n${listData.totalEntries} entries`);
          } else {
            outputJson(result.data, true);
          }
          if (result.warning) console.warn(`Warning: ${result.warning}`);
        } else {
          console.error(`Error: ${result.error}`);
          if (result.policyDecision) console.error(`Policy: ${result.policyDecision}`);
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

// ── Top-level Browser Action Handler (Section 5) ────────────────────

async function handleBrowserAction(action: string, args: ParsedArgs): Promise<void> {
  const { positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const { SessionManager } = await import("./session_manager");
  const { BrowserActions } = await import("./browser/actions");
  const { formatActionResult } = await import("./shared/action_result");

  // Use or create a session manager singleton
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }

  const browserActions = new BrowserActions({ sessionManager: _sessionManager });

  try {
    let result: import("./shared/action_result").ActionResult | undefined;

    switch (action) {
      case "open": {
        const url = positional[0];
        if (!url) {
          console.error("Error: URL is required");
          process.exit(1);
        }
        result = await browserActions.open({
          url,
          waitUntil: flags["wait-until"] as any ?? "domcontentloaded",
        });
        break;
      }

      case "snapshot": {
        result = await browserActions.takeSnapshot({
          rootSelector: flags["root-selector"],
        });
        break;
      }

      case "click": {
        const target = positional[0];
        if (!target) {
          console.error("Error: Target (ref, selector, or text) is required");
          process.exit(1);
        }
        result = await browserActions.click({
          target,
          timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
          force: flags.force === "true",
        });
        break;
      }

      case "fill": {
        const target = positional[0];
        const text = positional[1];
        if (!target || !text) {
          console.error("Error: Target and text are required");
          process.exit(1);
        }
        result = await browserActions.fill({
          target,
          text,
          timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
          commit: flags.commit === "true",
        });
        break;
      }

      case "hover": {
        const target = positional[0];
        if (!target) {
          console.error("Error: Target is required");
          process.exit(1);
        }
        result = await browserActions.hover({
          target,
          timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
        });
        break;
      }

      case "type": {
        const text = positional[0];
        if (!text) {
          console.error("Error: Text is required");
          process.exit(1);
        }
        result = await browserActions.type({
          text,
          delayMs: flags.delay ? Number(flags.delay) : undefined,
        });
        break;
      }

      case "press": {
        const key = positional[0];
        if (!key) {
          console.error("Error: Key is required (e.g., Enter, Tab, ArrowDown)");
          process.exit(1);
        }
        result = await browserActions.press({ key });
        break;
      }

      case "scroll": {
        const direction = positional[0] ?? "down";
        if (!["up", "down", "left", "right"].includes(direction)) {
          console.error("Error: Direction must be up, down, left, or right");
          process.exit(1);
        }
        result = await browserActions.scroll({
          direction: direction as "up" | "down" | "left" | "right",
          amount: flags.amount ? Number(flags.amount) : undefined,
        });
        break;
      }

      case "screenshot": {
        result = await browserActions.screenshot({
          outputPath: flags.output,
          fullPage: flags["full-page"] === "true",
          target: flags.target,
        });
        break;
      }

      case "tab": {
        const tabAction = args.subcommand;
        if (tabAction === "list") {
          result = await browserActions.tabList();
        } else if (tabAction === "switch") {
          const tabId = positional[0];
          if (!tabId) {
            console.error("Error: Tab ID is required");
            process.exit(1);
          }
          result = await browserActions.tabSwitch(tabId);
        } else {
          console.error("Error: Unknown tab command. Use 'tab list' or 'tab switch <id>'");
          process.exit(1);
        }
        break;
      }

      case "close": {
        result = await browserActions.close();
        break;
      }

      default:
        console.error(`Unknown browser action: ${action}`);
        process.exit(1);
    }

    if (result) {
      if (jsonOutput) {
        outputJson(formatActionResult(result), false);
      } else {
        if (result.success) {
          // Human-friendly output
          if (result.data) outputJson(result.data, true);
          else console.log("OK");
          if (result.warning) console.warn(`Warning: ${result.warning}`);
        } else {
          console.error(`Error: ${result.error}`);
          if (result.policyDecision) console.error(`Policy: ${result.policyDecision}`);
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

// ── Session Handler (Section 5) ────────────────────────────────────────

async function handleSession(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const { SessionManager } = await import("./session_manager");
  const { formatActionResult } = await import("./shared/action_result");

  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }

  try {
    let result: import("./shared/action_result").ActionResult | undefined;

    switch (subcommand) {
      case "list": {
        result = _sessionManager.list();
        break;
      }

      case "create": {
        const name = positional[0];
        if (!name) {
          console.error("Error: Session name is required");
          process.exit(1);
        }
        result = await _sessionManager.create(name, {
          policyProfile: flags.policy,
          workingDirectory: flags.cwd,
        });
        break;
      }

      case "use": {
        const nameOrId = positional[0];
        if (!nameOrId) {
          console.error("Error: Session name or ID is required");
          process.exit(1);
        }
        result = _sessionManager.use(nameOrId);
        break;
      }

      case "status": {
        result = _sessionManager.status();
        break;
      }

      default:
        console.error(`Unknown session command: ${subcommand}`);
        console.error("Available: list, create, use, status");
        process.exit(1);
    }

    if (result) {
      if (jsonOutput) {
        outputJson(formatActionResult(result), false);
      } else {
        if (result.success) {
          outputJson(result.data, true);
          if (result.warning) console.warn(`Warning: ${result.warning}`);
        } else {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

// ── Service Handler (Section 14) ─────────────────────────────────────

async function handleService(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  const { SessionManager } = await import("./session_manager");
  const { ServiceActions } = await import("./service_actions");
  const { formatActionResult } = await import("./shared/action_result");

  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }

  const serviceActions = new ServiceActions({ sessionManager: _sessionManager });

  try {
    let result: import("./shared/action_result").ActionResult | undefined;

    switch (subcommand) {
      case "register": {
        const name = positional[0];
        if (!name) {
          console.error("Error: Service name is required");
          process.exit(1);
        }
        const rawPort = flags.port ? Number(flags.port) : undefined;
        const detect = flags.detect === "true";
        const cwd = flags.cwd;

        let port = rawPort;

        if (detect && cwd) {
          const { detectDevServer } = await import("./services/detector");
          const detected = detectDevServer(cwd);
          if (detected) {
            port = detected.port;
          }
        }

        if (port === undefined || Number.isNaN(port)) {
          console.error("Error: --port is required when detection is not used or detection fails");
          process.exit(1);
        }

        result = await serviceActions.register({
          name,
          port,
          protocol: flags.protocol as "http" | "https" | undefined,
          path: flags.path,
          detect,
          cwd,
        });
        break;
      }

      case "list": {
        result = serviceActions.list();
        break;
      }

      case "resolve": {
        const name = positional[0];
        if (!name) {
          console.error("Error: Service name is required");
          process.exit(1);
        }
        result = await serviceActions.resolve({ name });
        break;
      }

      case "remove": {
        const name = positional[0];
        if (!name) {
          console.error("Error: Service name is required");
          process.exit(1);
        }
        result = serviceActions.remove({ name });
        break;
      }

      default:
        console.error(`Unknown service command: ${subcommand}`);
        console.error("Available: register, list, resolve, remove");
        process.exit(1);
    }

    if (result) {
      if (jsonOutput) {
        outputJson(formatActionResult(result), false);
      } else {
        if (result.success) {
          if (result.data) outputJson(result.data, true);
          else console.log("OK");
          if (result.warning) console.warn(`Warning: ${result.warning}`);
        } else {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
      }
    }
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

async function handleDebug(args: ParsedArgs): Promise<void> {
  const { subcommand, positional, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "bundle": {
      const bundleId = positional[0];
      if (!bundleId) {
        console.error("Error: Bundle ID is required");
        process.exit(1);
      }
      requireCliPolicy("debug_bundle_export", { bundleId, output: flags.output }, jsonOutput);

      try {
        const { loadDebugBundle } = await import("./observability/debug_bundle");
        const store = new MemoryStore();
        const bundle = loadDebugBundle(bundleId, store);
        store.close();

        if (!bundle) {
          console.error(`Error: Bundle "${bundleId}" not found`);
          process.exit(1);
        }

        if (flags.output) {
          const fs = await import("node:fs");
          fs.writeFileSync(flags.output, JSON.stringify(bundle, null, 2));
          console.log(`Bundle saved to: ${flags.output}`);
        } else {
          outputJson(bundle, !jsonOutput);
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "console": {
      try {
        const { getGlobalConsoleCapture } = await import("./observability/console_capture");
        const capture = getGlobalConsoleCapture();
        const sessionId = flags.session ?? "default";
        requireCliPolicy("debug_console_read", { sessionId }, jsonOutput);
        const entries = capture.getEntries(sessionId);

        if (jsonOutput) {
          outputJson({ sessionId, entries }, false);
        } else {
          console.log(`Console entries for session: ${sessionId} (${entries.length} total)`);
          for (const entry of entries.slice(-20)) {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            console.log(`  [${time}] ${entry.level.toUpperCase()}: ${entry.message.slice(0, 200)}`);
          }
          if (entries.length > 20) {
            console.log(`  ... and ${entries.length - 20} more`);
          }
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    case "network": {
      try {
        const { getGlobalNetworkCapture } = await import("./observability/network_capture");
        const capture = getGlobalNetworkCapture();
        const sessionId = flags.session ?? "default";
        requireCliPolicy("debug_network_read", { sessionId }, jsonOutput);
        const entries = capture.getEntries(sessionId);

        if (jsonOutput) {
          outputJson({ sessionId, entries }, false);
        } else {
          console.log(`Network entries for session: ${sessionId} (${entries.length} total)`);
          for (const entry of entries.slice(-20)) {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const statusStr = entry.status ? ` [${entry.status}]` : "";
            const errorStr = entry.error ? ` ERROR: ${entry.error}` : "";
            console.log(`  [${time}] ${entry.method} ${entry.url.slice(0, 80)}${statusStr}${errorStr}`);
          }
          if (entries.length > 20) {
            console.log(`  ... and ${entries.length - 20} more`);
          }
        }
      } catch (error) {
        console.error("Error:", (error as Error).message);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown debug command: ${subcommand}`);
      console.error("Available: bundle <id>, console [--session=<id>], network [--session=<id>]");
      process.exit(1);
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error("Fatal error:", error.message);
    process.exit(1);
  });
}
