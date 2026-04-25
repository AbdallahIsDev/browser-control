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

export function resolvePackageRoot(cwd: string): string {
  const resolved = path.resolve(cwd);
  return path.basename(resolved) === "dist" ? path.dirname(resolved) : resolved;
}

export function resolveDaemonEntryPoint(cwd: string): { command: string; args: string[] } {
  const root = resolvePackageRoot(cwd);

  const distEntry = path.join(root, "dist", "daemon.js");
  if (fs.existsSync(distEntry)) {
    return {
      command: process.execPath,
      args: [distEntry],
    };
  }

  const sourceEntry = path.join(root, "daemon.ts");
  if (fs.existsSync(sourceEntry)) {
    return {
      command: process.execPath,
      args: [require.resolve("ts-node/dist/bin.js"), sourceEntry],
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
    cwd: options.cwd ?? resolvePackageRoot(__dirname),
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
