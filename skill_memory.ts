import type { MemoryStore } from "./memory_store";

/**
 * A thin wrapper around MemoryStore that prefixes all keys with `skill:{name}:`.
 * Skills call simple keys like "positions" and the wrapper persists as "skill:framer:positions".
 */
export class SkillMemoryStore {
  private readonly store: MemoryStore;
  private readonly prefix: string;

  constructor(store: MemoryStore, skillName: string) {
    this.store = store;
    this.prefix = `skill:${skillName}:`;
  }

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  get<T = unknown>(key: string): T | null {
    return this.store.get<T>(this.prefixKey(key));
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.store.set(this.prefixKey(key), value, ttlMs);
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
}
