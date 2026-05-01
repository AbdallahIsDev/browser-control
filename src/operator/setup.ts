import fs from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { getConfigValue, loadConfig, loadUserConfig, setUserConfigValue } from "../shared/config";
import { ensureDataHomeAtPath } from "../shared/paths";
import { isDebugPortReady } from "../browser/core";
import { detectShell } from "../terminal/cross_platform";
import { execCommand } from "../terminal/session";
import type { SetupResult } from "./types";

export interface SetupOptions {
  env?: NodeJS.ProcessEnv;
  nonInteractive?: boolean;
  json?: boolean;
  profile?: string;
  browserMode?: "managed" | "attach";
  chromeDebugPort?: number;
  chromeBindAddress?: string;
  terminalShell?: string;
  browserlessEndpoint?: string;
  browserlessApiKey?: string;
  generateMcpConfig?: boolean;
  skipBrowserTest?: boolean;
  skipTerminalTest?: boolean;
}

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} (${fallback}): `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const env = options.env ?? process.env;
  const nonInteractive = options.nonInteractive === true;
  const changed: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  let profile = options.profile ?? "balanced";
  let browserMode = options.browserMode ?? "attach";
  let chromeDebugPort = options.chromeDebugPort ?? 9222;
  let chromeBindAddress = options.chromeBindAddress ?? "127.0.0.1";

  if (!nonInteractive) {
    profile = await ask("Policy profile: safe, balanced, trusted", profile);
    browserMode = await ask("Browser mode: managed or attach", browserMode) as "managed" | "attach";
    chromeDebugPort = Number(await ask("Chrome debug port", String(chromeDebugPort)));
    chromeBindAddress = await ask("Chrome bind address", chromeBindAddress);
  }

  ensureDataHomeAtPath(loadConfig({ env, validate: false }).dataHome);

  const shell = options.terminalShell ?? (() => {
    try {
      return detectShell().name;
    } catch {
      return process.platform === "win32" ? "powershell" : "sh";
    }
  })();

  const before = loadUserConfig({ env });
  const writes: Array<[string, unknown]> = [
    ["policyProfile", profile],
    ["browserMode", browserMode],
    ["chromeDebugPort", chromeDebugPort],
    ["chromeBindAddress", chromeBindAddress],
    ["terminalShell", shell],
    ["terminalCols", 80],
    ["terminalRows", 24],
  ];

  if (options.browserlessEndpoint) writes.push(["browserlessEndpoint", options.browserlessEndpoint]);
  if (options.browserlessApiKey) writes.push(["browserlessApiKey", options.browserlessApiKey]);

  let configPath = "";
  for (const [key, value] of writes) {
    const previous = (before as Record<string, unknown>)[key];
    const result = setUserConfigValue(key, value, { env });
    configPath = result.configPath;
    if (previous !== value) changed.push(`config.${result.key}`);
  }

  const effective = loadConfig({ env, validate: false });

  if (options.skipBrowserTest) {
    skipped.push("browser-test");
  } else {
    const reachable = await isDebugPortReady(effective.chromeDebugPort);
    if (!reachable) warnings.push(`CDP port ${effective.chromeDebugPort} is not reachable yet.`);
  }

  if (options.skipTerminalTest) {
    skipped.push("terminal-test");
  } else {
    const terminalResult = await execCommand("echo browser-control-setup", {
      shell: effective.terminalShell,
      timeoutMs: 5000,
    });
    if (terminalResult.exitCode !== 0) warnings.push(`Terminal test failed: ${terminalResult.stderr || terminalResult.stdout}`);
  }

  fs.mkdirSync(effective.dataHome, { recursive: true });

  const mcpConfigSnippet = options.generateMcpConfig === false ? undefined : {
    mcpServers: {
      "browser-control": {
        command: "bc",
        args: ["mcp", "serve"],
      },
    },
  };

  return {
    success: true,
    changed,
    skipped,
    warnings,
    configPath,
    dataHome: getConfigValue("dataHome", { env }).value as string,
    ...(mcpConfigSnippet ? { mcpConfigSnippet } : {}),
  };
}
