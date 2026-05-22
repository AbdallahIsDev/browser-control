/**
 * Browser Auth State — Cookie and storage persistence for Browser Control.
 *
 * Provides export/import of browser auth state:
 *  - cookies (primary — most auth relies on this)
 *  - localStorage (where practical — requires page context per origin)
 *  - sessionStorage (where practical — limited by browser security model)
 *
 * Auth snapshots are stored per-profile in MemoryStore under `auth_snapshot:` prefix.
 *
 * Integrates with existing `saveContextCookies` / `restoreContextCookies` from memory_store.ts.
 */

import type { BrowserContext, Page } from "playwright";
import { MemoryStore, saveContextCookies, restoreContextCookies } from "../runtime/memory_store";
import { logger } from "../shared/logger";

const log = logger.withComponent("browser_auth_state");

// ── Types ───────────────────────────────────────────────────────────

export interface CookieRecord {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface AuthSnapshot {
  /** Profile that this snapshot belongs to */
  profileId: string;
  /** All cookies from the browser context */
  cookies: CookieRecord[];
  /** localStorage per origin { origin: { key: value } } */
  localStorage: Record<string, Record<string, string>>;
  /** sessionStorage per origin — limited, may be empty */
  sessionStorage: Record<string, Record<string, string>>;
  /** Playwright-native storage state. Primary persisted auth format. */
  storageState?: PlaywrightStorageState;
  /** Snapshot format marker for migration-compatible readers. */
  formatVersion?: 2;
  /** ISO timestamp when snapshot was captured */
  capturedAt: string;
  /** Optional human-readable label */
  label?: string;
}

export interface PlaywrightStorageState {
  cookies: CookieRecord[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
    indexedDB?: unknown[];
  }>;
}

export interface ExportOptions {
  /** Include localStorage (requires navigating to each origin) */
  includeLocalStorage?: boolean;
  /** Include sessionStorage */
  includeSessionStorage?: boolean;
  /** Origins to capture storage from (if not specified, captures from all open pages) */
  origins?: string[];
  /** Human-readable label for the snapshot */
  label?: string;
}

export interface ImportOptions {
  /** Only import cookies, skip storage */
  cookiesOnly?: boolean;
  /** Origins to restore storage for */
  origins?: string[];
}

// ── Export ───────────────────────────────────────────────────────────

/**
 * Export auth state (cookies + storage) from a browser context.
 */
export async function exportAuthSnapshot(
  context: BrowserContext,
  profileId: string,
  options: ExportOptions = {},
): Promise<AuthSnapshot> {
  const storageState = await exportPlaywrightStorageState(context);
  const cookies = storageState.cookies;
  const localStorage = storageStateToLocalStorage(storageState);
  const sessionStorage: Record<string, Record<string, string>> = {};

  if (options.includeSessionStorage ?? false) {
    const targetPages = getPagesForOrigins(context, options.origins);

    for (const page of targetPages) {
      try {
        const origin = new URL(page.url()).origin;
        const storage = await extractSessionStorage(page);
        if (Object.keys(storage).length > 0) {
          sessionStorage[origin] = storage;
        }
      } catch (error: unknown) {
        log.warn(`Failed to extract sessionStorage from ${page.url()}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const snapshot: AuthSnapshot = {
    profileId,
    cookies,
    localStorage,
    sessionStorage,
    storageState,
    formatVersion: 2,
    capturedAt: new Date().toISOString(),
    label: options.label,
  };

  log.info("Auth snapshot exported", {
    profileId,
    cookieCount: cookies.length,
    localStorageDomains: Object.keys(localStorage).length,
    sessionStorageDomains: Object.keys(sessionStorage).length,
  });

  return snapshot;
}

// ── Import ──────────────────────────────────────────────────────────

/**
 * Import auth state into a browser context.
 */
export async function importAuthSnapshot(
  context: BrowserContext,
  snapshot: AuthSnapshot,
  options: ImportOptions = {},
): Promise<void> {
  const normalized = normalizeAuthSnapshot(snapshot);
  // Import cookies
  if (normalized.cookies.length > 0) {
    await context.addCookies(normalized.cookies);
    log.info(`Imported ${normalized.cookies.length} cookies.`);
  }

  // Import localStorage (requires page navigation to each origin)
  if (!options.cookiesOnly && Object.keys(normalized.localStorage).length > 0) {
    const targetOrigins = options.origins
      ? Object.keys(normalized.localStorage).filter((o) =>
          options.origins!.some((target) => o.includes(target)),
        )
      : Object.keys(normalized.localStorage);

    await installLocalStorageInitScripts(context, normalized.localStorage, targetOrigins);

    for (const origin of targetOrigins) {
      const storage = normalized.localStorage[origin];
      if (!storage || Object.keys(storage).length === 0) {
        continue;
      }

      try {
        // We need a page at this origin to set localStorage
        const existingPage = context.pages().find((p) => {
          try {
            return new URL(p.url()).origin === origin;
          } catch {
            return false;
          }
        });

        if (existingPage) {
          await injectLocalStorage(existingPage, storage);
        } else {
          log.info(`Skipping localStorage for ${origin} — no page at this origin.`);
        }
      } catch (error: unknown) {
        log.warn(`Failed to import localStorage for ${origin}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  log.info("Auth snapshot imported", {
    profileId: normalized.profileId,
    cookies: normalized.cookies.length,
  });
}

// ── Memory Store Persistence ────────────────────────────────────────

const AUTH_SNAPSHOT_PREFIX = "auth_snapshot:";

/** Save an auth snapshot to the memory store. */
export function saveAuthSnapshotToStore(
  store: MemoryStore,
  profileId: string,
  snapshot: AuthSnapshot,
  ttlMs?: number,
): void {
  store.set(`${AUTH_SNAPSHOT_PREFIX}${profileId}`, snapshot, ttlMs);
  log.info(`Auth snapshot saved for profile "${profileId}".`);
}

/** Load an auth snapshot from the memory store. */
export function loadAuthSnapshot(
  store: MemoryStore,
  profileId: string,
): AuthSnapshot | null {
  return store.get<AuthSnapshot>(`${AUTH_SNAPSHOT_PREFIX}${profileId}`);
}

/** Delete an auth snapshot from the memory store. */
export function deleteAuthSnapshot(
  store: MemoryStore,
  profileId: string,
): void {
  store.delete(`${AUTH_SNAPSHOT_PREFIX}${profileId}`);
}

/** List all profile IDs that have saved auth snapshots. */
export function listAuthSnapshots(store: MemoryStore): string[] {
  return store.keys(AUTH_SNAPSHOT_PREFIX).map((key) =>
    key.slice(AUTH_SNAPSHOT_PREFIX.length),
  );
}

/**
 * Save auth state from a context to the memory store.
 * This is a higher-level helper that combines export + store.
 */
export async function saveAuthSnapshot(
  store: MemoryStore,
  profileId: string,
  context: BrowserContext,
  options: ExportOptions = {},
  ttlMs?: number,
): Promise<AuthSnapshot> {
  const snapshot = await exportAuthSnapshot(context, profileId, options);
  saveAuthSnapshotToStore(store, profileId, snapshot, ttlMs);
  return snapshot;
}

/**
 * Restore auth state from the memory store into a context.
 * This is a higher-level helper that combines load + import.
 */
export async function restoreAuthSnapshot(
  store: MemoryStore,
  profileId: string,
  context: BrowserContext,
  options: ImportOptions = {},
): Promise<boolean> {
  const snapshot = loadAuthSnapshot(store, profileId);
  if (!snapshot) {
    return false;
  }

  await importAuthSnapshot(context, snapshot, options);
  return true;
}

// ── Storage Extraction Helpers ──────────────────────────────────────

async function extractLocalStorage(page: Page): Promise<Record<string, string>> {
  try {
    return await page.evaluate(() => {
      const result: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null) {
          const value = localStorage.getItem(key);
          if (value !== null) {
            result[key] = value;
          }
        }
      }
      return result;
    });
  } catch {
    return {};
  }
}

async function exportPlaywrightStorageState(context: BrowserContext): Promise<PlaywrightStorageState> {
  try {
    return await context.storageState({ indexedDB: true }) as PlaywrightStorageState;
  } catch (error: unknown) {
    log.warn(`IndexedDB storageState export failed; retrying without IndexedDB: ${error instanceof Error ? error.message : String(error)}`);
    return await context.storageState() as PlaywrightStorageState;
  }
}

function storageStateToLocalStorage(
  storageState: PlaywrightStorageState,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const entry of storageState.origins ?? []) {
    const values: Record<string, string> = {};
    for (const item of entry.localStorage ?? []) {
      values[item.name] = item.value;
    }
    if (Object.keys(values).length > 0) {
      result[entry.origin] = values;
    }
  }
  return result;
}

function localStorageToStorageStateOrigins(
  localStorage: Record<string, Record<string, string>>,
): PlaywrightStorageState["origins"] {
  return Object.entries(localStorage).map(([origin, values]) => ({
    origin,
    localStorage: Object.entries(values).map(([name, value]) => ({ name, value })),
  }));
}

export function normalizeAuthSnapshot(snapshot: AuthSnapshot): AuthSnapshot {
  const storageState = snapshot.storageState ?? {
    cookies: snapshot.cookies ?? [],
    origins: localStorageToStorageStateOrigins(snapshot.localStorage ?? {}),
  };
  return {
    ...snapshot,
    cookies: storageState.cookies ?? snapshot.cookies ?? [],
    localStorage: Object.keys(snapshot.localStorage ?? {}).length > 0
      ? snapshot.localStorage
      : storageStateToLocalStorage(storageState),
    sessionStorage: snapshot.sessionStorage ?? {},
    storageState,
    formatVersion: snapshot.formatVersion ?? 2,
  };
}

function getPagesForOrigins(context: BrowserContext, origins?: string[]): Page[] {
  const pages = context.pages();
  const validPages = pages.filter((p) => !p.url().startsWith("about:") && !p.url().startsWith("chrome:"));
  if (!origins) return validPages;
  return validPages.filter((p) => {
    try {
      const origin = new URL(p.url()).origin;
      return origins.some((o) => origin.includes(o));
    } catch {
      return false;
    }
  });
}

async function installLocalStorageInitScripts(
  context: BrowserContext,
  localStorage: Record<string, Record<string, string>>,
  targetOrigins: string[],
): Promise<void> {
  for (const origin of targetOrigins) {
    const storage = localStorage[origin];
    if (!storage || Object.keys(storage).length === 0) continue;
    await context.addInitScript(
      ({ expectedOrigin, entries }) => {
        if (globalThis.location?.origin !== expectedOrigin) return;
        for (const [key, value] of Object.entries(entries)) {
          globalThis.localStorage?.setItem(key, String(value));
        }
      },
      { expectedOrigin: origin, entries: storage },
    ).catch((error: unknown) => {
      log.warn(`Failed to install localStorage init script for ${origin}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function extractSessionStorage(page: Page): Promise<Record<string, string>> {
  try {
    return await page.evaluate(() => {
      const result: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key !== null) {
          const value = sessionStorage.getItem(key);
          if (value !== null) {
            result[key] = value;
          }
        }
      }
      return result;
    });
  } catch {
    return {};
  }
}

async function injectLocalStorage(
  page: Page,
  storage: Record<string, string>,
): Promise<void> {
  await page.evaluate((entries: Record<string, string>) => {
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }
  }, storage);
}
