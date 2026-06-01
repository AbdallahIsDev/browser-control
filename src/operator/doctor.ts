import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { isDebugPortReady } from "../browser/core";
import { formatLaunchBrowserCommand } from "../browser/launch_help";
import { sizeOfPath } from "../browser/profiles";
import { getConfigValue, loadConfig, loadUserConfig } from "../shared/config";
import { MemoryStore } from "../runtime/memory_store";
import { ProviderRegistry } from "../providers/registry";
import { loadProxyConfigs } from "../proxy_manager";
import { getLocalhostCaStatus } from "../services/local_ca";
import { getProfilesDir } from "../shared/paths";
import { detectShell, resolveNamedShell } from "../terminal/cross_platform";
import { probeDaemonHealth } from "../session_manager";
import { resolveChromePath } from "../runtime/launch_browser";
import type { DoctorCheckResult, DoctorReport, DoctorRunResult } from "./types";

export type DoctorCheck = () => Promise<DoctorCheckResult>;

interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  checks?: DoctorCheck[];
  profileSizeWarnBytes?: number;
  diskSpaceWarnBytes?: number;
}

const DEFAULT_PROFILE_SIZE_WARN_BYTES = 500 * 1024 * 1024;
const DEFAULT_DISK_SPACE_WARN_BYTES = 1024 * 1024 * 1024;

function result(
  id: string,
  name: string,
  category: string,
  status: DoctorCheckResult["status"],
  details: string,
  fix: string,
  critical: boolean,
): DoctorCheckResult {
  return { id, name, category, status, details, fix, critical };
}

function nodeSatisfies(engine: string | undefined, version = process.versions.node): boolean {
  if (!engine) return true;
  const major = Number(version.split(".")[0]);
  const minMatch = />=\s*(\d+)/u.exec(engine);
  if (minMatch) return major >= Number(minMatch[1]);
  return true;
}

function resolvePackageJsonPath(): string {
  const candidates = [
    path.join(__dirname, "..", "package.json"),
    path.join(__dirname, "..", "..", "package.json"),
    path.join(process.cwd(), "package.json"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Unable to locate browser-control package.json");
  return found;
}

function canConnectToLoopbackPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function existingPathForStatfs(target: string): string {
  let current = path.resolve(target);
  const root = path.parse(current).root;
  while (!fs.existsSync(current) && current !== root) {
    current = path.dirname(current);
  }
  return fs.existsSync(current) ? current : root;
}

async function runCheck(check: DoctorCheck): Promise<DoctorCheckResult> {
  try {
    return await check();
  } catch (error) {
    return result(
      "check.error",
      "Doctor Check Error",
      "runtime",
      "fail",
      error instanceof Error ? error.message : String(error),
      "Re-run with --json and inspect the failing check details.",
      true,
    );
  }
}

export function buildDoctorChecks(options: DoctorOptions = {}): DoctorCheck[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig({ env, validate: false });
  const profileSizeWarnBytes = options.profileSizeWarnBytes ?? DEFAULT_PROFILE_SIZE_WARN_BYTES;
  const diskSpaceWarnBytes = options.diskSpaceWarnBytes ?? DEFAULT_DISK_SPACE_WARN_BYTES;

  return [
    async () => {
      const pkgPath = resolvePackageJsonPath();
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { engines?: { node?: string } };
      const engine = pkg.engines?.node;
      return nodeSatisfies(engine)
        ? result("node.version", "Node.js Version", "runtime", "pass", `Node ${process.versions.node} satisfies ${engine ?? "package requirements"}.`, "No action needed.", true)
        : result("node.version", "Node.js Version", "runtime", "fail", `Node ${process.versions.node} does not satisfy ${engine}.`, `Install Node.js matching ${engine}.`, true);
    },
    async () => {
      const home = config.dataHome;
      fs.mkdirSync(home, { recursive: true });
      const testPath = path.join(home, `.doctor-write-${process.pid}-${Date.now()}`);
      fs.writeFileSync(testPath, "ok");
      fs.unlinkSync(testPath);
      return result("data.home.writable", "Data Home Writable", "filesystem", "pass", `${home} exists and is writable.`, "No action needed.", true);
    },
    async () => {
      try {
        const statPath = existingPathForStatfs(config.dataHome);
        const stats = fs.statfsSync(statPath);
        const availableBytes = stats.bavail * stats.bsize;
        return availableBytes < diskSpaceWarnBytes
          ? result(
              "data.home.diskSpace",
              "Data Home Disk Space",
              "filesystem",
              "warn",
              `${formatBytes(availableBytes)} available for ${config.dataHome}; threshold is ${formatBytes(diskSpaceWarnBytes)}.`,
              "Free disk space or move BROWSER_CONTROL_HOME to a larger volume before long browser/runtime sessions.",
              false,
            )
          : result(
              "data.home.diskSpace",
              "Data Home Disk Space",
              "filesystem",
              "pass",
              `${formatBytes(availableBytes)} available for ${config.dataHome}.`,
              "No action needed.",
              false,
            );
      } catch (error) {
        return result(
          "data.home.diskSpace",
          "Data Home Disk Space",
          "filesystem",
          "warn",
          error instanceof Error ? error.message : String(error),
          "Check available disk space for BROWSER_CONTROL_HOME manually.",
          false,
        );
      }
    },
    async () => {
      const store = new MemoryStore({ filename: path.join(config.dataHome, "memory.sqlite") });
      try {
        const key = `doctor:${Date.now()}`;
        store.set(key, { ok: true });
        const value = store.get<{ ok: boolean }>(key);
        store.delete(key);
        return value?.ok
          ? result("memory.store", "Session Store", "storage", "pass", "memory.sqlite can be opened and written.", "No action needed.", true)
          : result("memory.store", "Session Store", "storage", "fail", "memory.sqlite read/write validation failed.", "Delete or repair memory.sqlite after backing up needed state.", true);
      } finally {
        store.close();
      }
    },
    async () => {
      try {
        const chromePath = resolveChromePath(process.platform, config.chromePath);
        return result("browser.chrome", "Chrome Availability", "browser", "pass", `Chrome found at ${chromePath}.`, "No action needed.", false);
      } catch (error) {
        return result(
          "browser.chrome",
          "Chrome Availability",
          "browser",
          "warn",
          error instanceof Error ? error.message : String(error),
          "Install Chrome or set BROWSER_CHROME_PATH. Terminal and filesystem commands can still run.",
          false,
        );
      }
    },
    async () => {
      const reachable = await isDebugPortReady(config.chromeDebugPort);
      return reachable
        ? result("browser.cdp", "CDP Attachability", "browser", "pass", `CDP port ${config.chromeDebugPort} is reachable.`, "No action needed.", false)
        : result(
          "browser.cdp",
          "CDP Attachability",
          "browser",
          "warn",
          `CDP port ${config.chromeDebugPort} is not reachable.`,
          `Close Chrome and run ${formatLaunchBrowserCommand(config.chromeDebugPort)}, or configure BROWSER_DEBUG_URL when browser automation is needed.`,
          false,
        );
    },
    async () => {
      const profilesDir = getProfilesDir(config.dataHome);
      if (!fs.existsSync(profilesDir)) {
        return result(
          "browser.profileSize",
          "Browser Profile Size",
          "browser",
          "pass",
          "No browser profile directory exists yet.",
          "No action needed.",
          false,
        );
      }
      const oversized = fs
        .readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const profilePath = path.join(profilesDir, entry.name);
          return { name: entry.name, sizeBytes: sizeOfPath(profilePath) };
        })
        .filter((entry) => entry.sizeBytes >= profileSizeWarnBytes)
        .sort((a, b) => b.sizeBytes - a.sizeBytes);
      if (oversized.length === 0) {
        return result(
          "browser.profileSize",
          "Browser Profile Size",
          "browser",
          "pass",
          `No browser profile exceeds ${formatBytes(profileSizeWarnBytes)}.`,
          "No action needed.",
          false,
        );
      }
      return result(
        "browser.profileSize",
        "Browser Profile Size",
        "browser",
        "warn",
        `Oversized browser profile(s): ${oversized
          .slice(0, 5)
          .map((entry) => `${entry.name}=${formatBytes(entry.sizeBytes)}`)
          .join(", ")}.`,
        "Review browser/profiles usage and remove stale named profiles with bc data cleanup --purge-profiles --dry-run=false --yes.",
        false,
      );
    },
    async () => {
      try {
        require.resolve("node-pty");
        return result("terminal.nodePty", "node-pty Support", "terminal", "pass", "node-pty is installed.", "No action needed.", true);
      } catch {
        return result("terminal.nodePty", "node-pty Support", "terminal", "fail", "node-pty is not available.", "Run npm install and ensure native dependencies can build.", true);
      }
    },
    async () => {
      try {
        const shell = config.terminalShell ? resolveNamedShell(config.terminalShell) : detectShell();
        return result("terminal.shell", "Default Shell", "terminal", "pass", `${shell.name} is available at ${shell.path}.`, "No action needed.", true);
      } catch (error) {
        return result("terminal.shell", "Default Shell", "terminal", "fail", error instanceof Error ? error.message : String(error), "Set terminalShell to a valid shell such as pwsh, powershell, bash, or sh.", true);
      }
    },
    async () => {
      try {
        loadConfig({ env, validate: true });
        loadUserConfig({ env });
        return result("policy.profile", "Policy Profile", "policy", "pass", `Policy profile ${config.policyProfile} is valid.`, "No action needed.", true);
      } catch (error) {
        return result("policy.profile", "Policy Profile", "policy", "fail", error instanceof Error ? error.message : String(error), "Use bc config set policyProfile safe|balanced|trusted.", true);
      }
    },
    async () => {
      try {
        const { buildToolRegistry } = await import("../mcp/tool_registry");
        const { createBrowserControl } = await import("../browser_control");
        const api = createBrowserControl();
        try {
          const names = buildToolRegistry(api).map((tool) => tool.name);
          const ready = names.includes("bc_status") && names.includes("bc_session_list");
          return ready
            ? result("mcp.surface", "MCP Surface", "mcp", "pass", "MCP tool registry is available.", "No action needed.", false)
            : result("mcp.surface", "MCP Surface", "mcp", "fail", "MCP registry is missing expected tools.", "Reinstall or rebuild Browser Control.", false);
        } finally {
          api.close();
        }
      } catch (error) {
        return result("mcp.surface", "MCP Surface", "mcp", "fail", error instanceof Error ? error.message : String(error), "Run npm install and npm run typecheck.", false);
      }
    },
    async () => {
      const probe = await probeDaemonHealth(config);
      return probe.running
        ? result("daemon.broker", "Daemon/Broker", "daemon", "pass", `Broker is reachable at ${probe.brokerUrl}.`, "No action needed.", false)
        : result("daemon.broker", "Daemon/Broker", "daemon", "warn", `Broker is not reachable at ${probe.brokerUrl}.`, "Run bc daemon start for daemon-backed tasks.", false);
    },
    async () => {
      const registry = new ProviderRegistry(config.dataHome);
      const providers = registry.list();
      const active = registry.getActiveName();
      return providers.builtIn.includes(active) || providers.providers.some((provider) => provider.name === active)
        ? result("provider.registry", "Provider Registry", "provider", "pass", `Active provider is ${active}.`, "No action needed.", false)
        : result("provider.registry", "Provider Registry", "provider", "fail", `Active provider ${active} is not registered.`, "Use bc browser provider use local.", false);
    },
    async () => {
      const servicePath = path.join(config.dataHome, "services", "registry.json");
      if (!fs.existsSync(servicePath)) {
        return result("service.registry", "Service Registry", "service", "pass", "No service registry is configured yet.", "No action needed.", false);
      }
      JSON.parse(fs.readFileSync(servicePath, "utf8"));
      return result("service.registry", "Service Registry", "service", "pass", "Service registry JSON is readable.", "No action needed.", false);
    },
    async () => {
      const configured = config.proxyList.length > 0 || fs.existsSync(path.join(cwd, "proxies.json"));
      if (!configured) return result("proxy.config", "Proxy Config", "network", "pass", "No proxy configuration present.", "No action needed.", false);
      const proxies = loadProxyConfigs({ cwd, env });
      const active = proxies.filter((proxy) => proxy.status === "active").length;
      return active > 0
        ? result("proxy.config", "Proxy Config", "network", "pass", `${active} active proxy entries found.`, "No action needed.", false)
        : result("proxy.config", "Proxy Config", "network", "warn", "Proxy config exists but no active proxy entries were found.", "Add an active proxy or remove stale proxy config.", false);
    },
    async () => {
      const conflicts = (
        await Promise.all([80, 443].map(async (port) => ({
          port,
          listening: await canConnectToLoopbackPort(port),
        })))
      ).filter((entry) => entry.listening);
      return conflicts.length === 0
        ? result("localhostProxy.ports", ".localhost Proxy Ports", "network", "pass", "No listener detected on loopback ports 80/443.", "No action needed unless enabling default HTTP/HTTPS proxy ports.", false)
        : result("localhostProxy.ports", ".localhost Proxy Ports", "network", "warn", `Loopback port(s) already listening: ${conflicts.map((entry) => entry.port).join(", ")}.`, "Use a non-default proxy port, stop the conflicting service, or reserve the intended Windows URL/port explicitly.", false);
    },
    async () =>
      {
        const ca = getLocalhostCaStatus({ caDir: path.join(config.dataHome, "certs", "localhost-ca") });
        if (!ca.ready) {
          return result(
            "localhostProxy.https",
            ".localhost Proxy HTTPS",
            "network",
            "warn",
            `Local CA material is missing at ${ca.caDir}.`,
            "Run bc service proxy ca create --yes, then bc service proxy ca install --yes if HTTPS .localhost is needed.",
            false,
          );
        }
        return result(
          "localhostProxy.https",
          ".localhost Proxy HTTPS",
          "network",
          ca.trusted === false ? "warn" : "pass",
          `Local CA material exists at ${ca.caDir}; trust status is ${String(ca.trusted)}.`,
          ca.trusted === true ? "No action needed." : "Run bc service proxy ca install --yes before relying on trusted HTTPS.",
          false,
        );
      },
    async () => {
      if (!config.captchaProvider) return result("captcha.config", "CAPTCHA Config", "captcha", "pass", "CAPTCHA provider is not configured.", "No action needed.", false);
      return config.captchaApiKey
        ? result("captcha.config", "CAPTCHA Config", "captcha", "pass", `${config.captchaProvider} is configured.`, "No action needed.", false)
        : result("captcha.config", "CAPTCHA Config", "captcha", "warn", `${config.captchaProvider} is configured without an API key.`, "Set CAPTCHA_API_KEY or bc config set captchaApiKey <key>.", false);
    },
    async () => {
      const aiConfigured = [
        getConfigValue("openrouterModel", { env, validate: false }),
        getConfigValue("openrouterBaseUrl", { env, validate: false }),
        getConfigValue("openrouterApiKey", { env, validate: false }),
      ].some((entry) => entry.source !== "default" && entry.value !== undefined && entry.value !== "");
      if (!aiConfigured) return result("openrouter.config", "OpenRouter Config", "ai", "pass", "OpenRouter is not explicitly configured.", "No action needed.", false);
      return config.openrouterApiKey
        ? result("openrouter.config", "OpenRouter Config", "ai", "pass", "OpenRouter API key is configured.", "No action needed.", false)
        : result("openrouter.config", "OpenRouter Config", "ai", "warn", "OpenRouter model/base URL is configured without an API key.", "Set OPENROUTER_API_KEY or bc config set openrouterApiKey <key>.", false);
    },
  ];
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorRunResult> {
  const checks = options.checks ?? buildDoctorChecks(options);
  const results = await Promise.all(checks.map(runCheck));
  const summary = {
    pass: results.filter((check) => check.status === "pass").length,
    warn: results.filter((check) => check.status === "warn").length,
    fail: results.filter((check) => check.status === "fail").length,
    criticalFailures: results.filter((check) => check.status === "fail" && check.critical).length,
  };
  const report: DoctorReport = {
    overall: summary.criticalFailures > 0 ? "unhealthy" : summary.warn > 0 || summary.fail > 0 ? "degraded" : "healthy",
    checks: results,
    summary,
    timestamp: new Date().toISOString(),
  };
  return {
    report,
    exitCode: summary.criticalFailures > 0 ? 1 : 0,
  };
}
