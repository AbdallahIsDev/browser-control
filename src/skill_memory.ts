import type { MemoryStore } from "./runtime/memory_store";

export interface SkillMemoryStoreOptions {
  maxBytes?: number;
  maxKeys?: number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_KEYS = 1000;

/**
 * A thin wrapper around MemoryStore that prefixes all keys with `skill:{name}:`.
 * Skills call simple keys like "positions" and the wrapper persists as "skill:framer:positions".
 */
export class SkillMemoryStore {
  private readonly store: MemoryStore;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly maxKeys: number;

  constructor(store: MemoryStore, skillName: string, options: SkillMemoryStoreOptions = {}) {
    this.store = store;
    this.prefix = `skill:${skillName}:`;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1) {
      throw new Error("Skill memory maxBytes must be a positive integer");
    }
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error("Skill memory maxKeys must be a positive integer");
    }
  }

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  get<T = unknown>(key: string): T | null {
    return this.store.get<T>(this.prefixKey(key));
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    const fullKey = this.prefixKey(key);
    this.enforceQuota(fullKey, value);
    this.store.set(fullKey, value, ttlMs);
  }

  delete(key: string): boolean {
    this.store.delete(this.prefixKey(key));
    return true;
  }

  keys(prefix?: string): string[] {
    const fullPrefix = prefix ? this.prefixKey(prefix) : this.prefix;
    const rawKeys = this.store.keys(fullPrefix);
    // Strip the skill prefix so callers see their own key namespace
    return rawKeys.map((k) => k.slice(this.prefix.length));
  }

  clear(): void {
    const rawKeys = this.store.keys(this.prefix);
    for (const key of rawKeys) {
      this.store.delete(key);
    }
  }

  /** Get the underlying raw MemoryStore for advanced use. */
  getRawStore(): MemoryStore {
    return this.store;
  }

  /** Get the prefix used by this scoped store. */
  getPrefix(): string {
    return this.prefix;
  }

  private enforceQuota(fullKey: string, value: unknown): void {
    const scopedKeys = this.store.keys(this.prefix);
    const isNewKey = !scopedKeys.includes(fullKey);
    if (isNewKey && scopedKeys.length >= this.maxKeys) {
      throw new Error(`Skill memory key quota exceeded: max ${this.maxKeys} keys`);
    }

    let totalBytes = this.entrySizeBytes(fullKey, value);
    for (const scopedKey of scopedKeys) {
      if (scopedKey === fullKey) continue;
      totalBytes += this.entrySizeBytes(scopedKey, this.store.get(scopedKey));
      if (totalBytes > this.maxBytes) {
        throw new Error(`Skill memory quota exceeded: max ${this.maxBytes} bytes`);
      }
    }

    if (totalBytes > this.maxBytes) {
      throw new Error(`Skill memory quota exceeded: max ${this.maxBytes} bytes`);
    }
  }

  private entrySizeBytes(fullKey: string, value: unknown): number {
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new Error("Skill memory values must be JSON-serializable");
    }
    return Buffer.byteLength(fullKey, "utf8") + Buffer.byteLength(json, "utf8");
  }
}
