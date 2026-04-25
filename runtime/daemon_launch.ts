import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { loadConfig } from "../shared/config";

export interface SpawnDaemonOptions {
  visible?: boolean;
  detached?: boolean;
  stdio?: SpawnOptions["stdio"];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

function getDefaultDaemonCwd(): string {
  const parent = path.resolve(__dirname, "..");
  return path.basename(parent) === "dist" ? path.resolve(parent, "..") : parent;
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

  const compiledEntry = path.join(cwd, "daemon.js");
  if (fs.existsSync(compiledEntry)) {
    return {
      command: process.execPath,
      args: [compiledEntry],
    };
  }

  const compiledRuntimeEntry = path.join(cwd, "runtime", "daemon.js");
  if (fs.existsSync(compiledRuntimeEntry)) {
    return {
      command: process.execPath,
      args: [compiledRuntimeEntry],
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
    cwd: options.cwd ?? getDefaultDaemonCwd(),
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

  const { command, args } = resolveDaemonEntryPoint(cwd);

  if (process.platform === "win32" && visible) {
    return spawn(command, args, {
      ...spawnOptions,
      stdio: options.stdio ?? ["ignore", "ignore", "pipe"],
      windowsHide: false,
    });
  }

  return spawn(command, args, spawnOptions);
}
