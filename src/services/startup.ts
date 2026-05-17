import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface LocalhostProxyStartupOptions {
  startupDir?: string;
  command?: string;
  port?: number;
  allowRemote?: boolean;
}

export interface LocalhostProxyStartupStatus {
  supported: boolean;
  enabled: boolean;
  filePath: string;
  platform: NodeJS.Platform;
}

const STARTUP_FILE_BASENAME = "browser-control-localhost-proxy";

export function getDefaultStartupDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "LaunchAgents");
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "autostart");
}

export function getLocalhostProxyStartupFilePath(options: LocalhostProxyStartupOptions = {}): string {
  const startupDir = options.startupDir ?? getDefaultStartupDir();
  if (process.platform === "win32") {
    return path.join(startupDir, `${STARTUP_FILE_BASENAME}.cmd`);
  }
  if (process.platform === "darwin") {
    return path.join(startupDir, "dev.abdallah.browser-control.localhost-proxy.plist");
  }
  return path.join(startupDir, "browser-control-localhost-proxy.desktop");
}

export function getLocalhostProxyStartupStatus(options: LocalhostProxyStartupOptions = {}): LocalhostProxyStartupStatus {
  const filePath = getLocalhostProxyStartupFilePath(options);
  return {
    supported: true,
    enabled: fs.existsSync(filePath),
    filePath,
    platform: process.platform,
  };
}

export function installLocalhostProxyStartup(options: LocalhostProxyStartupOptions = {}): LocalhostProxyStartupStatus {
  const filePath = getLocalhostProxyStartupFilePath(options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buildStartupFileContent(options), "utf8");
  return getLocalhostProxyStartupStatus(options);
}

export function uninstallLocalhostProxyStartup(options: LocalhostProxyStartupOptions = {}): LocalhostProxyStartupStatus {
  const filePath = getLocalhostProxyStartupFilePath(options);
  fs.rmSync(filePath, { force: true });
  return getLocalhostProxyStartupStatus(options);
}

function buildStartupCommand(options: LocalhostProxyStartupOptions): string {
  const command = options.command ?? "bc";
  const args = [
    "service",
    "proxy",
    "start",
    "--background=true",
    "--port",
    String(options.port ?? 80),
    ...(options.allowRemote ? ["--allow-remote", "true"] : []),
  ];
  return [command, ...args].map(quoteShellArg).join(" ");
}

function buildStartupFileContent(options: LocalhostProxyStartupOptions): string {
  const command = buildStartupCommand(options);
  if (process.platform === "win32") {
    return `@echo off\r\n${command}\r\n`;
  }
  if (process.platform === "darwin") {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
      `<plist version="1.0">`,
      `<dict>`,
      `  <key>Label</key><string>dev.abdallah.browser-control.localhost-proxy</string>`,
      `  <key>ProgramArguments</key>`,
      `  <array><string>/bin/sh</string><string>-lc</string><string>${escapeXml(command)}</string></array>`,
      `  <key>RunAtLoad</key><true/>`,
      `</dict>`,
      `</plist>`,
      ``,
    ].join("\n");
  }
  return [
    `[Desktop Entry]`,
    `Type=Application`,
    `Name=Browser Control .localhost Proxy`,
    `Exec=${command}`,
    `X-GNOME-Autostart-enabled=true`,
    ``,
  ].join("\n");
}

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:=\\-]+$/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
