/**
 * Dev Server Detector — Narrow auto-detection for known local dev servers.
 *
 * Scope:
 *   - Inspect project config files (vite.config.*, next.config.*, etc.)
 *   - Inspect package.json scripts for default ports
 *   - Infer default ports when config is absent
 *
 * Does NOT:
 *   - Scan the entire machine
 *   - Add long-running watchers
 *   - Depend on process-table magic
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../shared/logger";

const log = logger.withComponent("service_detector");

// ── Types ───────────────────────────────────────────────────────────

export interface DetectedService {
  name: string;
  port: number;
  protocol: "http" | "https";
  path: string;
  source: "config" | "package_json" | "default";
}

// ── Known Defaults ──────────────────────────────────────────────────

const DEFAULT_PORTS: Record<string, { port: number; protocol: "http" | "https"; path: string }> = {
  vite: { port: 5173, protocol: "http", path: "/" },
  next: { port: 3000, protocol: "http", path: "/" },
  webpack: { port: 8080, protocol: "http", path: "/" },
};

// ── File Readers ────────────────────────────────────────────────────

function safeReadJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function findConfigFile(cwd: string, basename: string): string | null {
  const extensions = [".js", ".ts", ".mjs", ".cjs", ".json"];
  for (const ext of extensions) {
    const full = path.join(cwd, `${basename}${ext}`);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// ── Extractors ──────────────────────────────────────────────────────

function extractPortFromScript(script: string): number | null {
  // Match --port=1234 or -p 1234 or --port 1234
  const portEq = script.match(/--port[=:]\s*(\d+)/);
  if (portEq) return Number(portEq[1]);
  const portSpace = script.match(/--port\s+(\d+)/);
  if (portSpace) return Number(portSpace[1]);
  const shortP = script.match(/-p\s+(\d+)/);
  if (shortP) return Number(shortP[1]);
  return null;
}

function extractPortFromConfigContent(content: string): number | null {
  // Very narrow regex-based extraction for common patterns
  const serverPort = content.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d+)/);
  if (serverPort) return Number(serverPort[1]);
  const exportPort = content.match(/export\s+default\s+\{[^}]*port\s*:\s*(\d+)/);
  if (exportPort) return Number(exportPort[1]);
  return null;
}

// ── Detectors ───────────────────────────────────────────────────────

function detectVite(cwd: string): DetectedService | null {
  const configFile = findConfigFile(cwd, "vite.config");
  const pkg = safeReadJson(path.join(cwd, "package.json")) as Record<string, unknown> | null;

  let port: number | null = null;
  let source: DetectedService["source"] = "default";

  if (configFile) {
    const content = safeReadFile(configFile);
    if (content) {
      const fromContent = extractPortFromConfigContent(content);
      if (fromContent) {
        port = fromContent;
        source = "config";
      }
    }
  }

  if (!port && pkg?.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, string>;
    for (const script of Object.values(scripts)) {
      const fromScript = extractPortFromScript(script);
      if (fromScript) {
        port = fromScript;
        source = "package_json";
        break;
      }
    }
  }

  if (!port) port = DEFAULT_PORTS.vite.port;

  return {
    name: "vite",
    port,
    protocol: "http",
    path: "/",
    source,
  };
}

function detectNext(cwd: string): DetectedService | null {
  const configFile = findConfigFile(cwd, "next.config");
  const pkg = safeReadJson(path.join(cwd, "package.json")) as Record<string, unknown> | null;

  let port: number | null = null;
  let source: DetectedService["source"] = "default";

  if (configFile) {
    const content = safeReadFile(configFile);
    if (content) {
      const fromContent = extractPortFromConfigContent(content);
      if (fromContent) {
        port = fromContent;
        source = "config";
      }
    }
  }

  if (!port && pkg?.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, string>;
    for (const script of Object.values(scripts)) {
      const fromScript = extractPortFromScript(script);
      if (fromScript) {
        port = fromScript;
        source = "package_json";
        break;
      }
    }
  }

  if (!port) port = DEFAULT_PORTS.next.port;

  return {
    name: "next",
    port,
    protocol: "http",
    path: "/",
    source,
  };
}

function detectWebpack(cwd: string): DetectedService | null {
  const configFile = findConfigFile(cwd, "webpack.config");
  const pkg = safeReadJson(path.join(cwd, "package.json")) as Record<string, unknown> | null;

  let port: number | null = null;
  let source: DetectedService["source"] = "default";

  if (configFile) {
    const content = safeReadFile(configFile);
    if (content) {
      const fromContent = extractPortFromConfigContent(content);
      if (fromContent) {
        port = fromContent;
        source = "config";
      }
    }
  }

  if (!port && pkg?.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, string>;
    for (const script of Object.values(scripts)) {
      const fromScript = extractPortFromScript(script);
      if (fromScript) {
        port = fromScript;
        source = "package_json";
        break;
      }
    }
  }

  if (!port) port = DEFAULT_PORTS.webpack.port;

  return {
    name: "webpack",
    port,
    protocol: "http",
    path: "/",
    source,
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Detect a known dev server in the given directory.
 *
 * Returns the first match found among Vite, Next.js, and Webpack.
 * Detection order: Vite → Next.js → Webpack.
 */
export function detectDevServer(cwd: string): DetectedService | null {
  // Presence check: look for telltale config files to avoid false positives
  const hasVite = findConfigFile(cwd, "vite.config") || fs.existsSync(path.join(cwd, "vite"));
  const hasNext = findConfigFile(cwd, "next.config") || fs.existsSync(path.join(cwd, ".next"));
  const hasWebpack = findConfigFile(cwd, "webpack.config");

  if (hasVite) {
    const result = detectVite(cwd);
    if (result) return result;
  }
  if (hasNext) {
    const result = detectNext(cwd);
    if (result) return result;
  }
  if (hasWebpack) {
    const result = detectWebpack(cwd);
    if (result) return result;
  }

  // Fallback: if no config files but package.json has matching dev scripts
  const pkg = safeReadJson(path.join(cwd, "package.json")) as Record<string, unknown> | null;
  if (pkg?.scripts && typeof pkg.scripts === "object") {
    const scripts = Object.values(pkg.scripts as Record<string, string>).join(" ").toLowerCase();
    if (scripts.includes("vite")) {
      const result = detectVite(cwd);
      if (result) return result;
    }
    if (scripts.includes("next")) {
      const result = detectNext(cwd);
      if (result) return result;
    }
    if (scripts.includes("webpack") || scripts.includes("webpack-dev-server")) {
      const result = detectWebpack(cwd);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Try to get the default port for a known dev server by name.
 * Returns null if the framework is not recognized.
 */
export function tryDetectDefaultPort(framework: string): number | null {
  const key = framework.toLowerCase();
  if (key === "vite") return DEFAULT_PORTS.vite.port;
  if (key === "next" || key === "next.js") return DEFAULT_PORTS.next.port;
  if (key === "webpack") return DEFAULT_PORTS.webpack.port;
  return null;
}
