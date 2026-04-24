/**
 * Service Registry — Global persistent registry for named local services.
 *
 * Stores a mapping from semantic service names to local URLs.
 * Follows the same JSON persistence pattern as browser_profiles.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { getServiceRegistryPath } from "../paths";
import { logger } from "../logger";

const log = logger.withComponent("service_registry");

// ── Types ───────────────────────────────────────────────────────────

export interface ServiceEntry {
  /** Service name (unique identifier) */
  name: string;
  /** Port number */
  port: number;
  /** Protocol: http or https */
  protocol: "http" | "https";
  /** URL path (default: "/") */
  path: string;
  /** ISO timestamp when the service was registered */
  registeredAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

export interface ServiceRegistryData {
  services: Record<string, ServiceEntry>;
  version: number;
  updatedAt: string;
}

const REGISTRY_VERSION = 1;

// ── Validation ──────────────────────────────────────────────────────

const VALID_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

export function isValidServiceName(name: string): boolean {
  return VALID_NAME_RE.test(name) && name.length >= 1 && name.length <= 64;
}

export function validateServiceName(name: string): void {
  if (!isValidServiceName(name)) {
    throw new Error(
      `Invalid service name "${name}". Names must be 1-64 chars, alphanumeric with hyphens/underscores, and cannot start or end with a hyphen/underscore.`
    );
  }
}

function normalizePath(value: string): string {
  if (!value || value === "/") return "/";
  let p = value;
  if (!p.startsWith("/")) p = "/" + p;
  // Remove trailing slash except for root
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function normalizeProtocol(value: string): "http" | "https" {
  const lower = value.toLowerCase();
  if (lower === "https") return "https";
  return "http";
}

// ── Persistence ─────────────────────────────────────────────────────

function loadRegistryData(): ServiceRegistryData {
  const registryPath = getServiceRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      const raw = fs.readFileSync(registryPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).services === "object" &&
        (parsed as Record<string, unknown>).services !== null
      ) {
        const services = (parsed as Record<string, unknown>).services as Record<string, unknown>;
        // Rebuild with null prototype to avoid inherited property pollution
        const cleanServices: Record<string, ServiceEntry> = Object.create(null);
        for (const key of Object.keys(services)) {
          const entry = services[key];
          if (
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as Record<string, unknown>).name === "string" &&
            typeof (entry as Record<string, unknown>).port === "number"
          ) {
            cleanServices[key] = entry as ServiceEntry;
          }
        }
        return {
          services: cleanServices,
          version: REGISTRY_VERSION,
          updatedAt: new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    log.warn(`Service registry file is corrupt or unreadable — resetting to empty registry. (${err instanceof Error ? err.message : String(err)})`);
  }
  return { services: Object.create(null), version: REGISTRY_VERSION, updatedAt: new Date().toISOString() };
}

function saveRegistryData(data: ServiceRegistryData): void {
  const registryPath = getServiceRegistryPath();
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(data, null, 2));
}

// ── Registry Manager ────────────────────────────────────────────────

export class ServiceRegistry {
  private data: ServiceRegistryData;

  constructor() {
    this.data = loadRegistryData();
  }

  /** Register or update a service */
  register(entry: { name: string; port: number; protocol?: "http" | "https"; path?: string }): ServiceEntry {
    validateServiceName(entry.name);
    if (entry.port < 1 || entry.port > 65535) {
      throw new Error(`Invalid port ${entry.port}. Must be between 1 and 65535.`);
    }

    const now = new Date().toISOString();
    const hadExisting = Object.prototype.hasOwnProperty.call(this.data.services, entry.name);
    const existing = hadExisting ? this.data.services[entry.name] : undefined;

    const fullEntry: ServiceEntry = {
      name: entry.name,
      port: entry.port,
      protocol: normalizeProtocol(entry.protocol ?? "http"),
      path: normalizePath(entry.path ?? "/"),
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
    };

    this.data.services[entry.name] = fullEntry;
    try {
      this.save();
    } catch (err) {
      if (hadExisting && existing) {
        this.data.services[entry.name] = existing;
      } else {
        delete this.data.services[entry.name];
      }
      throw err;
    }

    log.info(`Service "${entry.name}" registered at ${fullEntry.protocol}://127.0.0.1:${fullEntry.port}${fullEntry.path}`);
    return fullEntry;
  }

  /** Remove a service by name */
  remove(name: string): boolean {
    validateServiceName(name);
    if (!Object.prototype.hasOwnProperty.call(this.data.services, name)) {
      return false;
    }
    const existing = this.data.services[name];
    delete this.data.services[name];
    try {
      this.save();
    } catch (err) {
      if (existing) this.data.services[name] = existing;
      throw err;
    }
    log.info(`Service "${name}" removed from registry.`);
    return true;
  }

  /** Get a service entry by name */
  get(name: string): ServiceEntry | null {
    if (Object.prototype.hasOwnProperty.call(this.data.services, name)) {
      return this.data.services[name] ?? null;
    }
    return null;
  }

  /** List all registered services */
  list(): ServiceEntry[] {
    return Object.values(this.data.services).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Check if a service is registered */
  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data.services, name);
  }

  /** Reload registry from disk */
  reload(): void {
    this.data = loadRegistryData();
  }

  private save(): void {
    try {
      saveRegistryData(this.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to save service registry: ${message}`);
    }
  }
}

/** Global singleton registry instance */
export const globalServiceRegistry = new ServiceRegistry();
