import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { loadConfig } from "./config";

export interface SpawnDaemonOptions {
  visible?: boolean;
  detached?: boolean;
  stdio?: SpawnOptions["stdio"];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function resolveDaemonEntryPoint(cwd: string): { command: string; args: string[] } {
  const sourceEntry = path.join(cwd, "daemon.ts");
  if (fs.existsSync(sourceEntry)) {
    return {
      command: process.execPath,
      args: [require.resolve("ts-node/dist/bin.js"), sourceEntry],
    };
  }

  const distEntry = path.join(cwd, "dist", "daemon.js");
  if (fs.existsSync(distEntry)) {
    return {
      command: process.execPath,
      args: [distEntry],
    };
  }

  throw new Error(`Unable to resolve daemon entry point from ${cwd}`);
}

export function buildDaemonSpawnOptions(
  options: SpawnDaemonOptions = {},
  platform: NodeJS.Platform = process.platform,
): SpawnOptions {
  const env = { ...process.env, ...(options.env ?? {}) };
  const config = loadConfig({ validate: false, env });
  const visible = options.visible ?? config.daemonVisible;
  return {
    cwd: options.cwd ?? __dirname,
    env,
    detached: options.detached ?? true,
    stdio: options.stdio ?? (platform === "win32" && !visible ? "ignore" : ["ignore", "ignore", "pipe"]),
    ...(platform === "win32" ? { windowsHide: !visible } : {}),
  };
}

export function spawnDaemonProcess(options: SpawnDaemonOptions = {}): ChildProcess {
  const spawnOptions = buildDaemonSpawnOptions(options);
  const cwd = spawnOptions.cwd as string;
  const env = spawnOptions.env as NodeJS.ProcessEnv;
  const config = loadConfig({ validate: false, env });
  const visible = options.visible ?? config.daemonVisible;

  if (process.platform === "win32" && visible) {
    return spawn("npx", ["ts-node", "daemon.ts"], {
      ...spawnOptions,
      stdio: options.stdio ?? ["ignore", "ignore", "pipe"],
      shell: true,
      windowsHide: false,
    });
  }

  const { command, args } = resolveDaemonEntryPoint(cwd);
  return spawn(command, args, spawnOptions);
}
