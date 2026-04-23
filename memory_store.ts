import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getMemoryStorePath } from "./paths";

interface MemoryStoreOptions {
  filename?: string;
  now?: () => number;
}

type CookieRecord = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  partitionKey?: string;
};

interface StoredCookieContext {
  cookies: () => Promise<CookieRecord[]>;
}

interface RestorableCookieContext {
  addCookies: (cookies: CookieRecord[]) => Promise<void>;
}

interface MemoryStoreStats {
  filename: string;
  totalKeys: number;
  collections: Record<string, number>;
  fileSizeBytes: number;
}

function getCollectionName(key: string): string {
  return key.split(":", 1)[0] ?? "default";
}

export function getDefaultMemoryStorePath(): string {
  return getMemoryStorePath();
}

export class MemoryStore {
  private readonly filename: string;

  private readonly now: () => number;

  private readonly db: DatabaseSync;

  constructor(options: MemoryStoreOptions = {}) {
    this.filename = options.filename ?? getDefaultMemoryStorePath();
    this.now = options.now ?? Date.now;

    if (this.filename !== ":memory:") {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    }

    this.db = new DatabaseSync(this.filename);

    // Enable WAL mode for better concurrent access — the daemon and CLI
    // both access the same database file, and the default journal mode
    // (rollback journal) causes "database is locked" errors under
    // concurrent readers/writers.
    if (this.filename !== ":memory:") {
      this.db.exec("PRAGMA journal_mode=WAL");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_store (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_store_expires_at
      ON memory_store (expires_at);
    `);
  }

  get<T>(key: string): T | null {
    this.deleteExpiredKey(key);

    const statement = this.db.prepare(`
      SELECT value_json
      FROM memory_store
      WHERE key = ?
      LIMIT 1
    `);
    const row = statement.get(key) as { value_json: string } | undefined;
    if (!row) {
      return null;
    }

    return JSON.parse(row.value_json) as T;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    const statement = this.db.prepare(`
      INSERT INTO memory_store (key, value_json, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `);

    statement.run(
      key,
      JSON.stringify(value),
      ttlMs ? this.now() + ttlMs : null,
      this.now(),
    );
  }

  delete(key: string): void {
    this.db.prepare(`DELETE FROM memory_store WHERE key = ?`).run(key);
  }

  keys(prefix?: string): string[] {
    this.deleteExpiredKeys();

    if (prefix) {
      const statement = this.db.prepare(`
        SELECT key
        FROM memory_store
        WHERE key LIKE ?
        ORDER BY key ASC
      `);
      const rows = statement.all(`${prefix}%`) as Array<{ key: string }>;
      return rows.map((row) => row.key);
    }

    const rows = this.db.prepare(`
      SELECT key
      FROM memory_store
      ORDER BY key ASC
    `).all() as Array<{ key: string }>;

    return rows.map((row) => row.key);
  }

  clear(): void {
    this.db.exec(`DELETE FROM memory_store`);
  }

  close(): void {
    this.db.close();
  }

  getStats(): MemoryStoreStats {
    this.deleteExpiredKeys();

    const rows = this.db.prepare(`
      SELECT key
      FROM memory_store
    `).all() as Array<{ key: string }>;

    const collections: Record<string, number> = {};
    for (const row of rows) {
      const collection = getCollectionName(row.key);
      collections[collection] = (collections[collection] ?? 0) + 1;
    }

    const fileSizeBytes = this.filename === ":memory:"
      ? 0
      : (fs.existsSync(this.filename) ? fs.statSync(this.filename).size : 0);

    return {
      filename: this.filename,
      totalKeys: rows.length,
      collections,
      fileSizeBytes,
    };
  }

  private deleteExpiredKeys(): void {
    this.db.prepare(`
      DELETE FROM memory_store
      WHERE expires_at IS NOT NULL
        AND expires_at <= ?
    `).run(this.now());
  }

  private deleteExpiredKey(key: string): void {
    this.db.prepare(`
      DELETE FROM memory_store
      WHERE key = ?
        AND expires_at IS NOT NULL
        AND expires_at <= ?
    `).run(key, this.now());
  }
}

export async function saveContextCookies(
  store: MemoryStore,
  sessionKey: string,
  context: StoredCookieContext,
  ttlMs?: number,
): Promise<void> {
  const cookies = await context.cookies();
  store.set(`sessions:${sessionKey}`, cookies, ttlMs);
}

export async function restoreContextCookies(
  store: MemoryStore,
  sessionKey: string,
  context: RestorableCookieContext,
): Promise<boolean> {
  const cookies = store.get<CookieRecord[]>(`sessions:${sessionKey}`);
  if (!cookies || cookies.length === 0) {
    return false;
  }

  await context.addCookies(cookies);
  return true;
}

async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const [command] = argv;
  if (command !== "stats") {
    console.error("[MEMORY_STORE] Unknown command. Supported commands: stats");
    return 1;
  }

  const store = new MemoryStore();
  try {
    console.log(JSON.stringify(store.getStats(), null, 2));
  } finally {
    store.close();
  }
  return 0;
}

if (require.main === module) {
  runCli().then((code) => {
    process.exit(code);
  }).catch((error: unknown) => {
    console.error(`[MEMORY_STORE] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
