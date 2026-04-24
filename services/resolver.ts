/**
 * Service Resolver — Shared logic for resolving stable local URLs.
 *
 * Supports:
 *   - Explicit `bc://<service-name>` references
 *   - Bare registered names (exact match only, no dots)
 *   - Passthrough for real URLs (http://, https://, etc.)
 *
 * Health checks are passive, on-demand, and use a short TCP probe.
 */

import net from "node:net";
import { ServiceRegistry, type ServiceEntry } from "./registry";
import { logger } from "../logger";

const log = logger.withComponent("service_resolver");

// ── Types ───────────────────────────────────────────────────────────

export interface ResolveResult {
  /** The resolved URL */
  url: string;
  /** The service entry that was resolved (if any) */
  service?: ServiceEntry;
  /** Whether the service responded to health check */
  healthy: boolean;
}

export interface ResolveError {
  error: string;
  code: "unknown_service" | "unhealthy_service" | "invalid_name";
}

// ── Constants ───────────────────────────────────────────────────────

const EXPLICIT_SCHEME = "bc://";
const HEALTH_TIMEOUT_MS = 2000;
const HEALTH_CACHE_TTL_MS = 30000;

// ── Health Cache ────────────────────────────────────────────────────

interface HealthCacheEntry {
  healthy: boolean;
  timestamp: number;
}

const healthCache = new Map<string, HealthCacheEntry>();

function getHealthCacheKey(name: string, entry: ServiceEntry): string {
  return `${name}:${entry.protocol}:${entry.port}:${entry.path}`;
}

function getCachedHealth(key: string): boolean | undefined {
  const entry = healthCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > HEALTH_CACHE_TTL_MS) {
    healthCache.delete(key);
    return undefined;
  }
  return entry.healthy;
}

function setCachedHealth(key: string, healthy: boolean): void {
  healthCache.set(key, { healthy, timestamp: Date.now() });
}

// ── TCP Health Probe ────────────────────────────────────────────────

function probePort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (healthy: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(healthy);
    };

    socket.setTimeout(HEALTH_TIMEOUT_MS);
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));

    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

// ── Resolution Logic ────────────────────────────────────────────────

/**
 * Determine if an input looks like a real URL (has a known scheme or dot).
 */
function looksLikeRealUrl(input: string): boolean {
  const lower = input.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("file://")) {
    return true;
  }
  // Hostnames with dots are not service names
  if (input.includes(".")) return true;
  return false;
}

/**
 * Check if an input is an explicit bc:// service reference.
 */
export function isServiceRef(input: string): boolean {
  return input.toLowerCase().startsWith(EXPLICIT_SCHEME);
}

/**
 * Extract the service name from a bc:// reference.
 */
function extractServiceName(input: string): string {
  return input.slice(EXPLICIT_SCHEME.length);
}

/**
 * Build a URL from a service entry.
 */
function buildServiceUrl(entry: ServiceEntry): string {
  const host = "127.0.0.1";
  const path = entry.path === "/" ? "" : entry.path;
  return `${entry.protocol}://${host}:${entry.port}${path}`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Resolve an input string to a URL.
 *
 * Behavior:
 *   - `bc://name` → look up name in registry, health check, return URL
 *   - bare name → if exact registry match and no dots, resolve; else passthrough
 *   - real URL → passthrough unchanged
 *
 * @param skipHealthCheck — when true, skip the TCP probe (used in tests)
 */
export async function resolveServiceUrl(
  input: string,
  registry: ServiceRegistry,
  skipHealthCheck = false,
): Promise<ResolveResult | ResolveError> {
  const trimmed = input.trim();

  // Explicit bc:// reference
  if (isServiceRef(trimmed)) {
    const name = extractServiceName(trimmed);
    const entry = registry.get(name);
    if (!entry) {
      return { error: `Unknown service "${name}". Use "bc service list" to see registered services.`, code: "unknown_service" };
    }

    const cacheKey = getHealthCacheKey(name, entry);
    const cached = getCachedHealth(cacheKey);
    const healthy = skipHealthCheck ? true : (cached ?? await probePort(entry.port));
    if (cached === undefined && !skipHealthCheck) setCachedHealth(cacheKey, healthy);

    if (!healthy) {
      return {
        error: `Service "${name}" is registered on port ${entry.port} but is not responding.`,
        code: "unhealthy_service",
      };
    }

    return { url: buildServiceUrl(entry), service: entry, healthy: true };
  }

  // Real URL passthrough
  if (looksLikeRealUrl(trimmed)) {
    return { url: trimmed, healthy: true };
  }

  // Bare name — exact registry match only
  const entry = registry.get(trimmed);
  if (entry) {
    const cacheKey = getHealthCacheKey(trimmed, entry);
    const cached = getCachedHealth(cacheKey);
    const healthy = skipHealthCheck ? true : (cached ?? await probePort(entry.port));
    if (cached === undefined && !skipHealthCheck) setCachedHealth(cacheKey, healthy);

    if (!healthy) {
      return {
        error: `Service "${trimmed}" is registered on port ${entry.port} but is not responding.`,
        code: "unhealthy_service",
      };
    }

    return { url: buildServiceUrl(entry), service: entry, healthy: true };
  }

  // Not a known service and not a real URL — treat as passthrough
  // (this preserves behavior for unknown inputs that may be valid URLs)
  return { url: trimmed, healthy: true };
}

/**
 * Synchronous check: does this input need service resolution?
 *
 * Returns true for bc:// refs or bare names that exist in the registry.
 * Used by callers to decide whether to invoke the async resolver.
 */
export function mightBeServiceRef(input: string, registry: ServiceRegistry): boolean {
  const trimmed = input.trim();
  if (isServiceRef(trimmed)) return true;
  if (looksLikeRealUrl(trimmed)) return false;
  return registry.has(trimmed);
}

/**
 * Build a URL string from a service entry (synchronous, no health check).
 */
export function serviceEntryToUrl(entry: ServiceEntry): string {
  return buildServiceUrl(entry);
}
