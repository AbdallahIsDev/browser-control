import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { ensureDataHome, getChromeDebugPath, getInteropDir, getWslBridgePidPath } from "../shared/paths";

interface LaunchOptions {
  port: number;
  bindAddress: string;
  chromePath?: string;
}

interface ChromeDebugState {
  port: number;
  bindAddress: string;
  windowsLoopbackUrl: string;
  localhostUrl: string;
  wslPreferredUrl: string | null;
  wslHostCandidates: string[];
  updatedAt: string;
}

const CHROME_CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "${LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ],
};

function resolveChromePath(platform: NodeJS.Platform, override?: string): string {
  if (override && override.trim()) {
    const explicitPath = override.trim();
    if (fs.existsSync(explicitPath)) {
      return explicitPath;
    }
    throw new Error(`Chrome not found at BROWSER_CHROME_PATH: ${explicitPath}`);
  }

  const rawCandidates = CHROME_CANDIDATES[platform] ?? CHROME_CANDIDATES.linux;
  const candidates = rawCandidates.map((c) =>
    c.replace("${LOCALAPPDATA}", process.env.LOCALAPPDATA ?? ""),
  );

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Chrome not found for platform "${platform}". ` +
      `Install Google Chrome or set BROWSER_CHROME_PATH to the executable path.`,
  );
}

function resolveUserDataDir(platform: NodeJS.Platform): string {
  const profileName = "BrowserControlProfile";
  switch (platform) {
    case "win32":
      return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "Google", "Chrome", profileName);
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", profileName);
    default:
      return path.join(os.homedir(), ".config", "google-chrome", profileName);
  }
}

function isLikelyWsl(): boolean {
  if (process.platform !== "linux") return false;
  return Boolean(
    process.env.WSL_DISTRO_NAME ||
      process.env.WSL_INTEROP ||
      os.release().toLowerCase().includes("microsoft"),
  );
}

/** Return true if value is a private RFC1918 IPv4 address. */
function isPrivateIpv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value.trim());
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

/** Check whether WSL is installed and available from a Windows host. */
function isWslAvailableFromWindows(): boolean {
  if (process.platform !== "win32") return false;
  const wslPath = process.env.WINDIR
    ? path.join(process.env.WINDIR, "System32", "wsl.exe")
    : "wsl.exe";
  try {
    if (fs.existsSync(wslPath)) return true;
    execSync("where wsl.exe", { encoding: "utf8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Discover WSL-reachable host IP addresses from a Windows host. */
function getWslHostCandidatesFromWindows(): string[] {
  if (!isWslAvailableFromWindows()) return [];
  const seen = new Set<string>();

  function add(ip: string): void {
    if (isPrivateIpv4(ip) && !seen.has(ip)) {
      seen.add(ip);
    }
  }

  // 1. Query the WSL vEthernet adapter IP via PowerShell
  try {
    const ps = "powershell -NoProfile -Command \"" +
      "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue " +
      "| Where-Object { $_.InterfaceAlias -like 'vEthernet (WSL*' -and $_.IPAddress -notlike '169.254.*' } " +
      "| Select-Object -ExpandProperty IPAddress" +
      "\"";
    const output = execSync(ps, { encoding: "utf8", timeout: 5000 }).trim();
    for (const line of output.split(/\r?\n/)) {
      add(line.trim());
    }
  } catch { /* ignore */ }

  // 2. Probe the WSL gateway via wsl.exe
  try {
    const output = execSync(
      'wsl.exe -e sh -lc "ip route | sed -n \'s/^default via //p\' | cut -d\' \' -f1 | head -n 1"',
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    add(output);
  } catch { /* ignore */ }

  // 3. Read nameservers from WSL resolv.conf via wsl.exe
  try {
    const output = execSync(
      'wsl.exe -e sh -lc "sed -n \'s/^nameserver //p\' /etc/resolv.conf"',
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    for (const line of output.split(/\r?\n/)) {
      add(line.trim());
    }
  } catch { /* ignore */ }

  return [...seen];
}

function buildChromeArgs(opts: { port: number; userDataDir: string; bindAddress: string }): string[] {
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
  ];

  if (opts.bindAddress && opts.bindAddress.trim()) {
    args.push(`--remote-debugging-address=${opts.bindAddress.trim()}`);
  }

  return args;
}

async function isPortListening(port: number, host: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const socket = net.connect({ port, host }, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitForCdp(port: number, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  let lastError: Error | undefined;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim().startsWith("[")) return true;
        console.error(`[waitForCdp] Port ${port} response ok, but invalid text:`, text.substring(0, 100));
      } else {
        console.error(`[waitForCdp] Port ${port} response not ok:`, response.status, response.statusText);
      }
    } catch (e: any) {
      lastError = e;
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`[waitForCdp] Port ${port} timed out after ${timeoutMs}ms. Last error:`, lastError?.message);
  return false;
}

function getWslHostCandidates(): string[] {
  // Inside WSL — read gateway/nameservers directly
  if (isLikelyWsl()) {
    return getWslHostCandidatesFromWsl();
  }
  // On Windows host with WSL available — probe via wsl.exe
  if (process.platform === "win32") {
    return getWslHostCandidatesFromWindows();
  }
  return [];
}

/** Discover WSL-reachable IPs from inside WSL (original behavior). */
function getWslHostCandidatesFromWsl(): string[] {
  const seen = new Set<string>();

  function add(ip: string): void {
    if (isPrivateIpv4(ip) && !seen.has(ip)) {
      seen.add(ip);
    }
  }

  // Try gateway from ip route
  try {
    const output = execSync("ip route | sed -n 's/^default via //p' | cut -d' ' -f1 | head -n 1", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    add(output);
  } catch {
    // ignore
  }

  // Try nameservers
  try {
    const resolv = fs.readFileSync("/etc/resolv.conf", "utf8");
    for (const line of resolv.split("\n")) {
      const match = line.match(/^nameserver\s+(\S+)/);
      if (match) add(match[1]);
    }
  } catch {
    // ignore
  }

  return [...seen];
}

function writeDebugState(opts: {
  port: number;
  bindAddress: string;
  wslHostCandidates: string[];
}): ChromeDebugState {
  const interopDir = getInteropDir();
  fs.mkdirSync(interopDir, { recursive: true });

  const wslPreferredUrl =
    opts.wslHostCandidates.length > 0
      ? `http://${opts.wslHostCandidates[0]}:${opts.port}`
      : null;

  const state: ChromeDebugState = {
    port: opts.port,
    bindAddress: opts.bindAddress,
    windowsLoopbackUrl: `http://127.0.0.1:${opts.port}`,
    localhostUrl: `http://localhost:${opts.port}`,
    wslPreferredUrl,
    wslHostCandidates: opts.wslHostCandidates,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(getChromeDebugPath(), JSON.stringify(state, null, 2));
  return state;
}

async function isChromeAlive(port: number): Promise<boolean> {
  return waitForCdp(port, 2000);
}

async function startWslBridgeIfNeeded(
  port: number,
  wslHostCandidates: string[],
  bridgeScriptPath: string,
): Promise<void> {
  if (wslHostCandidates.length === 0) return;

  const listenHost = wslHostCandidates[0];
  const bridgeUrl = `http://${listenHost}:${port}/json`;
  const bridgePidPath = getWslBridgePidPath(port);

  // Check if bridge is already working
  try {
    const response = await fetch(bridgeUrl, { signal: AbortSignal.timeout(2000) });
    if (response.ok) return; // bridge already working
  } catch {
    // bridge not running
  }

  if (fs.existsSync(bridgePidPath)) {
    try {
      const stalePid = Number(fs.readFileSync(bridgePidPath, "utf8").trim());
      if (stalePid > 0) {
        if (process.platform === "win32") {
          try { execSync(`taskkill /T /F /PID ${stalePid}`, { stdio: "ignore" }); } catch { /* best effort */ }
        } else {
          try { process.kill(stalePid, "SIGTERM"); } catch { /* best effort */ }
        }
      }
    } catch {
      // ignore stale pid parsing issues
    }
    try { fs.unlinkSync(bridgePidPath); } catch { /* best effort */ }
  }

  const bridgePath = path.resolve(bridgeScriptPath);
  if (!fs.existsSync(bridgePath)) {
    console.warn(`WSL bridge script not found at ${bridgePath}, skipping bridge.`);
    return;
  }

  console.log(`Starting WSL CDP bridge on ${listenHost}:${port}...`);
  const bridgeProcess = spawn(
    process.execPath,
    [
      bridgePath,
      "--listen-host", listenHost,
      "--listen-port", String(port),
      "--target-host", "127.0.0.1",
      "--target-port", String(port),
    ],
    { detached: true, stdio: "ignore", ...(process.platform === "win32" ? { windowsHide: true } : {}) },
  );
  bridgeProcess.unref();
  try {
    fs.writeFileSync(bridgePidPath, String(bridgeProcess.pid));
  } catch {
    // best effort
  }

  // Wait for bridge to be ready
  for (let i = 0; i < 10; i++) {
    try {
      const response = await fetch(bridgeUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        console.log("WSL CDP bridge ready.");
        return;
      }
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn("WSL CDP bridge did not become ready in time.");
}

function stopWslBridge(port: number): void {
  const bridgePidPath = getWslBridgePidPath(port);
  if (!fs.existsSync(bridgePidPath)) {
    return;
  }

  try {
    const pid = Number(fs.readFileSync(bridgePidPath, "utf8").trim());
    if (pid > 0) {
      if (process.platform === "win32") {
        try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" }); } catch { /* best effort */ }
      } else {
        try { process.kill(pid, "SIGTERM"); } catch { /* best effort */ }
      }
    }
  } catch {
    // ignore malformed pid files
  }

  try { fs.unlinkSync(bridgePidPath); } catch { /* best effort */ }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const port = Number(args[0] || process.env.BROWSER_DEBUG_PORT || "9222");
  const bindAddress = args[1] || process.env.BROWSER_BIND_ADDRESS || "0.0.0.0";
  const chromeOverride = process.env.BROWSER_CHROME_PATH;

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port: ${args[0]}`);
  }

  const platform = process.platform;
  const insideWsl = isLikelyWsl();
  const wslFromWindows = platform === "win32" && isWslAvailableFromWindows();

  console.log(
    `Browser Control Launcher — platform: ${platform}` +
    `${insideWsl ? " (inside WSL)" : ""}` +
    `${wslFromWindows ? " (WSL available)" : ""}, port: ${port}`
  );

  // Ensure data home directories exist
  ensureDataHome();

  // Resolve Chrome
  const chromePath = resolveChromePath(platform, chromeOverride);
  console.log(`Chrome: ${chromePath}`);

  // Compute WSL host candidates (works from both WSL and Windows)
  const wslHostCandidates = getWslHostCandidates();
  const needsBridge = wslHostCandidates.length > 0;

  // Check for existing Chrome on this port
  if (await isChromeAlive(port)) {
    console.log(`Chrome already running on port ${port}.`);
    const ready = await waitForCdp(port, 5000);
    if (ready) {
      writeDebugState({ port, bindAddress, wslHostCandidates });
      console.log(`SUCCESS: Chrome debug session ready on port ${port}`);

      if (needsBridge) {
        const bridgeScript = path.resolve(__dirname, "..", "wsl_cdp_bridge.cjs");
        await startWslBridgeIfNeeded(port, wslHostCandidates, bridgeScript);
      }
      return;
    }
    console.log("Existing Chrome not responding on debug port. Restarting...");
    // Fall through to launch new instance
  }

  // Resolve user data dir
  const userDataDir = resolveUserDataDir(platform);
  fs.mkdirSync(userDataDir, { recursive: true });

  // Build Chrome args
  const chromeArgs = buildChromeArgs({ port, userDataDir, bindAddress });

  // Launch Chrome
  console.log(`Launching Chrome with --remote-debugging-port=${port}...`);
  const chromeProcess = spawn(chromePath, chromeArgs, {
    detached: true,
    stdio: "ignore",
    ...(platform === "win32" ? { windowsHide: false } : {}),
  });
  chromeProcess.unref();

  // Wait for CDP to be ready
  const ready = await waitForCdp(port, 15000);
  if (!ready) {
    throw new Error(`Chrome did not become ready on port ${port} within 15 seconds.`);
  }

  // Write debug metadata
  writeDebugState({ port, bindAddress, wslHostCandidates });
  console.log(`SUCCESS: Chrome debug session ready on port ${port}`);

  // Start WSL bridge when we have candidates (works from both WSL and Windows)
  if (needsBridge) {
    const bridgeScript = path.resolve(__dirname, "..", "wsl_cdp_bridge.cjs");
    await startWslBridgeIfNeeded(port, wslHostCandidates, bridgeScript);
  }
}

// Exported for use by launch_browser.cjs shim
export { main as _main };

// Also export helpers for testing
export {
  resolveChromePath,
  resolveUserDataDir,
  isLikelyWsl,
  isPrivateIpv4,
  isWslAvailableFromWindows,
  getWslHostCandidates,
  getWslHostCandidatesFromWsl,
  getWslHostCandidatesFromWindows,
  isChromeAlive,
  startWslBridgeIfNeeded,
  stopWslBridge,
  waitForCdp,
  buildChromeArgs,
  writeDebugState,
  type LaunchOptions,
  type ChromeDebugState,
};
