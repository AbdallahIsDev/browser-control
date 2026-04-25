import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ProviderConfig,
  type ProviderRegistryData,
  type ProviderSelectionResult,
  type ProviderListResult,
  type ProviderAddResult,
  type ProviderRemoveResult,
  PROVIDER_REGISTRY_VERSION,
  DEFAULT_PROVIDER_NAME,
} from "./types";
import { getProviderRegistryPath } from "../paths";
import { redactUrl } from "./utils";

const BUILT_IN_PROVIDERS: ProviderConfig[] = [
  { name: "local", type: "local" },
  { name: "custom", type: "custom" },
  { name: "browserless", type: "browserless" },
];

const BUILT_IN_NAMES = BUILT_IN_PROVIDERS.map((p) => p.name);

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
      const parsed = JSON.parse(raw) as ProviderRegistryData;
      if (!parsed || typeof parsed !== "object") {
        return getDefaultRegistry();
      }
      if (!parsed.version || parsed.version !== PROVIDER_REGISTRY_VERSION) {
        // Migrate or reset
        return {
          ...getDefaultRegistry(),
          providers: Array.isArray(parsed.providers) ? parsed.providers : [],
          activeProvider: typeof parsed.activeProvider === "string" ? parsed.activeProvider : DEFAULT_PROVIDER_NAME,
        };
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

  get(name: string): ProviderConfig | undefined {
    // Stored providers win over built-ins for configurable built-ins
    const stored = this.data.providers.find((p) => p.name === name);
    if (stored) return stored;
    return BUILT_IN_PROVIDERS.find((p) => p.name === name);
  }

  add(config: ProviderConfig): ProviderAddResult {
    if (PROTECTED_BUILT_IN_NAMES.has(config.name)) {
      return { success: false, persisted: false, error: `Cannot override built-in provider "${config.name}".` };
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
