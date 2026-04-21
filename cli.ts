#!/usr/bin/env ts-node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MemoryStore } from "./memory_store";
import { loadProxyConfigs } from "./proxy_manager";
import { Telemetry } from "./telemetry";
import { getPidFilePath, getReportsDir, ensureDataHome, getSkillsDataDir } from "./paths";
import { loadConfig } from "./config";

// DEFAULT_PORT kept for help text; actual port comes from loadConfig()

interface ParsedArgs {
  command: string;
  subcommand?: string;
  flags: Record<string, string>;
  positional: string[];
}

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

function printHelp(): void {
  console.log(`
Browser Control CLI

Usage: bc <command> [subcommand] [options]

Commands:
  run --skill=<name> --action=<action> [--params='{"key":"value"}']  Run a task
  schedule <id> --cron="*/5 * * * *" --skill=<name> --action=<action> Schedule a task
  schedule list                                                      List scheduled tasks
  schedule pause <id>                                                Pause a scheduled task
  schedule resume <id>                                               Resume a scheduled task
  schedule remove <id>                                               Remove a scheduled task
  daemon start                                                       Start the daemon
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

Flags:
  --json                                                             Raw JSON output
  --help, -h                                                         Show help

Environment:
  BROKER_PORT                                                        Broker API port (default: 7788)
`);
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

async function handleDaemon(args: ParsedArgs): Promise<void> {
  const { subcommand, flags } = args;
  const jsonOutput = flags.json === "true";

  switch (subcommand) {
    case "start": {
      const daemonProcess = spawn("ts-node", ["daemon.ts"], {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      });

      const errorChunks: Buffer[] = [];
      daemonProcess.stderr?.on("data", (chunk: Buffer) => {
        errorChunks.push(chunk);
      });

      // Wait briefly to detect immediate crashes
      const startupTimeout = 2000;
      const exited = await new Promise<boolean>((resolve) => {
        daemonProcess.on("exit", () => resolve(true));
        setTimeout(() => resolve(false), startupTimeout);
      });

      if (exited) {
        const errorOutput = Buffer.concat(errorChunks).toString("utf8");
        console.error("Daemon failed to start:", errorOutput || "Process exited immediately");
        process.exit(1);
      }

      // Process is still running after timeout — it started successfully
      daemonProcess.stderr?.removeAllListeners();

      // Ensure .interop directory exists
      const interopDir = path.dirname(getPidFilePath());
      if (!fs.existsSync(interopDir)) {
        fs.mkdirSync(interopDir, { recursive: true });
      }

      fs.writeFileSync(getPidFilePath(), String(daemonProcess.pid));
      daemonProcess.unref();

      console.log(`Daemon started with PID: ${daemonProcess.pid}`);
      break;
    }

    case "stop": {
      if (!fs.existsSync(getPidFilePath())) {
        console.log("Daemon is not running (no PID file)");
        process.exit(1);
      }

      const pid = Number(fs.readFileSync(getPidFilePath(), "utf8").trim());
      try {
        process.kill(pid, "SIGTERM");
        fs.unlinkSync(getPidFilePath());
        console.log(`Daemon stopped (PID: ${pid})`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          fs.unlinkSync(getPidFilePath());
          console.log("Daemon was not running (stale PID file removed)");
        } else {
          console.error("Error:", (error as Error).message);
          process.exit(1);
        }
      }
      break;
    }

    case "status": {
      if (!fs.existsSync(getPidFilePath())) {
        console.log(jsonOutput ? '{"running":false}' : "Daemon is not running");
        break;
      }

      const pid = Number(fs.readFileSync(getPidFilePath(), "utf8").trim());
      try {
        process.kill(pid, 0); // Check if process exists
        const status = { running: true, pid };
        outputJson(status, !jsonOutput);
      } catch {
        fs.unlinkSync(getPidFilePath());
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
  } = await import("./policy_profiles");

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

  switch (args.command) {
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

    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error("Fatal error:", error.message);
    process.exit(1);
  });
}