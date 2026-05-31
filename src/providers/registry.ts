import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ProviderConfig,
  type ProviderRegistryData,
  type ProviderSelectionResult,
  type ProviderListResult,
  type ProviderCatalogEntry,
  type ProviderAddResult,
  type ProviderRemoveResult,
  PROVIDER_REGISTRY_VERSION,
  DEFAULT_PROVIDER_NAME,
} from "./types";
import { getProviderRegistryPath } from "../shared/paths";
import { redactUrl } from "./utils";

const BUILT_IN_PROVIDERS: ProviderConfig[] = [
  { name: "local", type: "local" },
  { name: "custom", type: "custom" },
  { name: "browserless", type: "browserless" },
  { name: "browserbase", type: "browserbase" },
  { name: "e2b", type: "e2b" },
  { name: "cubesandbox", type: "cubesandbox" },
  { name: "camofox", type: "camofox" },
  { name: "cloak", type: "cloak" },
  { name: "obscura", type: "obscura" },
];

const BUILT_IN_NAMES = BUILT_IN_PROVIDERS.map((p) => p.name);
const PROVIDER_TYPES: ProviderConfig["type"][] = [
  "local",
  "custom",
  "browserless",
  "browserbase",
  "e2b",
  "cubesandbox",
  "camofox",
  "cloak",
  "obscura",
];
const PROVIDER_TYPE_SET = new Set<ProviderConfig["type"]>(PROVIDER_TYPES);
const PROVIDER_CONFIG_KEYS = new Set(["name", "type", "endpoint", "apiKey", "options"]);
const PROVIDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROVIDER_ENDPOINT_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const DANGEROUS_OPTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    name: "local",
    label: "Local Chrome",
    description: "Runs a loopback managed browser on this machine. Default provider for private local automation.",
    remote: false,
    risk: "moderate",
    requiresEndpoint: false,
    requiresAuth: false,
    launchSupported: true,
    attachSupported: true,
    defaultConfigured: true,
    setupHint: "No remote credentials required. Use for default local automation.",
  },
  {
    name: "custom",
    label: "Custom CDP",
    description: "Connects to an explicitly configured Chrome DevTools endpoint.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: false,
    launchSupported: false,
    attachSupported: true,
    defaultConfigured: false,
    setupHint: "Add a provider with a ws://, wss://, http://, or https:// CDP endpoint.",
  },
  {
    name: "browserless",
    label: "Browserless",
    description: "Uses a Browserless remote browser endpoint when the operator supplies endpoint credentials.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: true,
    launchSupported: true,
    attachSupported: true,
    defaultConfigured: false,
    setupHint: "Configure endpoint and API key before selecting this provider.",
  },
  {
    name: "browserbase",
    label: "Browserbase",
    description: "Creates or attaches to Browserbase hosted browser sessions when credentials are configured.",
    remote: true,
    risk: "high",
    requiresEndpoint: false,
    requiresAuth: true,
    launchSupported: true,
    attachSupported: true,
    defaultConfigured: false,
    setupHint: "Configure API key and project id before selecting this provider.",
  },
  {
    name: "e2b",
    label: "E2B Sandbox",
    description: "Reserved high-risk remote sandbox provider extension point. Runtime adapter is intentionally disabled until reviewed and explicitly configured.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: true,
    launchSupported: false,
    attachSupported: false,
    defaultConfigured: false,
    setupHint: "Use only with a reviewed adapter and explicit endpoint/API key. Not default-enabled.",
  },
  {
    name: "cubesandbox",
    label: "CubeSandbox",
    description: "Reserved high-risk sandbox provider extension point for future isolated browser/helper runtimes.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: true,
    launchSupported: false,
    attachSupported: false,
    defaultConfigured: false,
    setupHint: "Use only with a reviewed adapter and explicit endpoint/API key. Not default-enabled.",
  },
  {
    name: "camofox",
    label: "Camofox",
    description: "Risky anti-detect browser provider extension point. Runtime is intentionally disabled and must never be default.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: false,
    launchSupported: false,
    attachSupported: false,
    defaultConfigured: false,
    setupHint: "Requires explicit opt-in, policy approval, and abuse-risk review before any adapter is enabled.",
  },
  {
    name: "cloak",
    label: "Cloak",
    description: "Risky anti-detect browser provider extension point. Runtime is intentionally disabled and must never be default.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: false,
    launchSupported: false,
    attachSupported: false,
    defaultConfigured: false,
    setupHint: "Requires explicit opt-in, policy approval, and abuse-risk review before any adapter is enabled.",
  },
  {
    name: "obscura",
    label: "Obscura",
    description: "Risky anti-detect browser provider extension point. Runtime is intentionally disabled and must never be default.",
    remote: true,
    risk: "high",
    requiresEndpoint: true,
    requiresAuth: false,
    launchSupported: false,
    attachSupported: false,
    defaultConfigured: false,
    setupHint: "Requires explicit opt-in, policy approval, and abuse-risk review before any adapter is enabled.",
  },
];

/** Built-ins that cannot be overridden (local must always remain local). */
const PROTECTED_BUILT_IN_NAMES = new Set(["local"]);

function getDefaultRegistry(): ProviderRegistryData {
  return {
    version: PROVIDER_REGISTRY_VERSION,
    providers: [],
    activeProvider: DEFAULT_PROVIDER_NAME,
    updatedAt: new Date().toISOString(),
  };
}

function redactProviderForList(config: ProviderConfig): ProviderConfig {
  const { apiKey: _apiKey, ...safeConfig } = config;
  return {
    ...safeConfig,
    endpoint: safeConfig.endpoint ? redactUrl(safeConfig.endpoint) : undefined,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 1000 && value.every((item) => isSafeJsonValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) => !DANGEROUS_OPTION_KEYS.has(key) && isSafeJsonValue(item, depth + 1),
  );
}

function isProviderType(value: unknown): value is ProviderConfig["type"] {
  return typeof value === "string" && PROVIDER_TYPE_SET.has(value as ProviderConfig["type"]);
}

function isValidProviderEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return PROVIDER_ENDPOINT_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function isValidProviderConfig(value: unknown): value is ProviderConfig {
  if (!isPlainRecord(value)) return false;
  if (Object.keys(value).some((key) => !PROVIDER_CONFIG_KEYS.has(key))) return false;
  if (typeof value.name !== "string" || !PROVIDER_NAME_PATTERN.test(value.name)) return false;
  if (!isProviderType(value.type)) return false;
  if ("endpoint" in value && value.endpoint !== undefined && !isValidProviderEndpoint(value.endpoint)) return false;
  if ("apiKey" in value && value.apiKey !== undefined && typeof value.apiKey !== "string") return false;
  if ("options" in value && value.options !== undefined && !isSafeJsonValue(value.options)) return false;
  if (PROTECTED_BUILT_IN_NAMES.has(value.name) && value.type !== BUILT_IN_PROVIDERS.find((p) => p.name === value.name)?.type) {
    return false;
  }
  return true;
}

function isValidRegistryData(value: unknown): value is ProviderRegistryData {
  if (!isPlainRecord(value)) return false;
  if (value.version !== PROVIDER_REGISTRY_VERSION) return false;
  if (!Array.isArray(value.providers) || !value.providers.every(isValidProviderConfig)) return false;
  if (typeof value.activeProvider !== "string" || !PROVIDER_NAME_PATTERN.test(value.activeProvider)) return false;
  if (typeof value.updatedAt !== "string") return false;
  if (!BUILT_IN_NAMES.includes(value.activeProvider) && !value.providers.some((p) => p.name === value.activeProvider)) {
    return false;
  }
  return true;
}

function getMigratedRegistry(parsed: unknown): ProviderRegistryData {
  if (!isPlainRecord(parsed)) return getDefaultRegistry();
  const providers = Array.isArray(parsed.providers) ? parsed.providers.filter(isValidProviderConfig) : [];
  const activeProvider =
    typeof parsed.activeProvider === "string" && PROVIDER_NAME_PATTERN.test(parsed.activeProvider)
      ? parsed.activeProvider
      : DEFAULT_PROVIDER_NAME;
  const migratedActiveProvider =
    BUILT_IN_NAMES.includes(activeProvider) || providers.some((provider) => provider.name === activeProvider)
      ? activeProvider
      : DEFAULT_PROVIDER_NAME;
  return {
    ...getDefaultRegistry(),
    providers,
    activeProvider: migratedActiveProvider,
  };
}

export class ProviderRegistry {
  private data: ProviderRegistryData;
  private readonly path: string;

  constructor(dataHome?: string) {
    this.path = getProviderRegistryPath(dataHome);
    this.data = this.load();
  }

  private load(): ProviderRegistryData {
    try {
      if (!existsSync(this.path)) {
        return getDefaultRegistry();
      }
      const raw = readFileSync(this.path, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!isValidRegistryData(parsed)) {
        if (isPlainRecord(parsed) && parsed.version !== PROVIDER_REGISTRY_VERSION) {
          return getMigratedRegistry(parsed);
        }
        return getDefaultRegistry();
      }
      return parsed;
    } catch {
      return getDefaultRegistry();
    }
  }

  private save(): boolean {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      if (process.platform !== "win32") {
        chmodSync(dir, 0o700);
      }
      this.data.updatedAt = new Date().toISOString();
      const tmpPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      try {
        writeFileSync(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
        if (process.platform !== "win32") {
          chmodSync(tmpPath, 0o600);
        }
        renameSync(tmpPath, this.path);
        if (process.platform !== "win32") {
          chmodSync(this.path, 0o600);
        }
      } catch (error) {
        try {
          rmSync(tmpPath, { force: true });
        } catch {
          // ignore temp cleanup failure
        }
        throw error;
      }
      return true;
    } catch {
      return false;
    }
  }

  list(): ProviderListResult {
    return {
      providers: this.data.providers.map(redactProviderForList),
      activeProvider: this.data.activeProvider,
      builtIn: [...BUILT_IN_NAMES],
    };
  }

  catalog(): ProviderCatalogEntry[] {
    return PROVIDER_CATALOG.map((entry) => ({ ...entry }));
  }

  get(name: string): ProviderConfig | undefined {
    // Stored providers win over built-ins for configurable built-ins
    const stored = this.data.providers.find((p) => p.name === name);
    if (stored) return stored;
    return BUILT_IN_PROVIDERS.find((p) => p.name === name);
  }

  add(config: ProviderConfig): ProviderAddResult {
    if (isPlainRecord(config) && typeof config.name === "string" && PROTECTED_BUILT_IN_NAMES.has(config.name)) {
      return { success: false, persisted: false, error: `Cannot override built-in provider "${config.name}".` };
    }

    if (!isValidProviderConfig(config)) {
      return { success: false, persisted: false, error: "Invalid provider configuration." };
    }

    const idx = this.data.providers.findIndex((p) => p.name === config.name);
    const previous = idx >= 0 ? this.data.providers[idx] : null;

    if (idx >= 0) {
      this.data.providers[idx] = config;
    } else {
      this.data.providers.push(config);
    }

    const persisted = this.save();
    if (!persisted) {
      // Rollback memory state
      if (previous) {
        this.data.providers[idx] = previous;
      } else {
        this.data.providers.pop();
      }
      return { success: false, persisted: false, error: "Failed to persist provider registry." };
    }

    return { success: true, persisted: true };
  }

  remove(name: string): ProviderRemoveResult {
    if (PROTECTED_BUILT_IN_NAMES.has(name)) {
      return { success: false, persisted: false, error: `Cannot remove built-in provider "${name}".` };
    }

    const before = [...this.data.providers];
    this.data.providers = this.data.providers.filter((p) => p.name !== name);
    const removed = this.data.providers.length < before.length;

    if (!removed && BUILT_IN_NAMES.includes(name)) {
      // Nothing to remove for a configurable built-in with no stored override
      return { success: false, persisted: false, error: `Provider "${name}" has no persisted configuration to remove.` };
    }

    if (removed) {
      const previousActive = this.data.activeProvider;
      if (this.data.activeProvider === name) {
        this.data.activeProvider = DEFAULT_PROVIDER_NAME;
      }
      const persisted = this.save();
      if (!persisted) {
        // Rollback memory state
        this.data.providers = before;
        this.data.activeProvider = previousActive;
        return { success: false, persisted: false, error: "Failed to persist provider registry." };
      }
      return { success: true, persisted: true };
    }

    return { success: false, persisted: false, error: `Provider "${name}" not found.` };
  }

  select(name: string): ProviderSelectionResult {
    const target = this.get(name);
    if (!target) {
      return {
        success: false,
        error: `Provider "${name}" not found.`,
      };
    }
    const previous = this.data.activeProvider;
    this.data.activeProvider = name;
    const persisted = this.save();
    if (!persisted) {
      this.data.activeProvider = previous;
      return { success: false, error: "Failed to persist active provider selection." };
    }
    return {
      success: true,
      provider: name,
      previousProvider: previous,
      persisted,
    };
  }

  getActive(): ProviderConfig {
    const active = this.get(this.data.activeProvider);
    return active ?? { name: DEFAULT_PROVIDER_NAME, type: "local" };
  }

  getActiveName(): string {
    return this.data.activeProvider;
  }
}
