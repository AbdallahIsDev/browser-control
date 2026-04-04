import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { getActiveStagehand, observe } from "@bac/stagehand_core";

export type SelectorCacheRecord = {
  selectorsDiscovered: boolean;
  discoveryNote: string;
} & Record<string, string | boolean | null>;

export type SelectorCacheKey<T extends SelectorCacheRecord> = Exclude<keyof T, "selectorsDiscovered" | "discoveryNote">;

export interface ResolveSelectorOptions {
  jsonPath?: string;
  timeoutMs?: number;
  descriptions?: Partial<Record<string, string>>;
}

/** Return the default path for selector cache files. */
export function getDefaultSelectorsPath(): string {
  return path.join(process.cwd(), "selectors.json");
}

/** Load a selector cache file and merge it with defaults. */
export function loadSelectorCache<T extends SelectorCacheRecord>(defaults: T, jsonPath = getDefaultSelectorsPath()): T {
  try {
    return {
      ...defaults,
      ...(JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Partial<T>),
    };
  } catch {
    return { ...defaults };
  }
}

/** Persist a selector cache file to disk. */
export function saveSelectorCache<T extends SelectorCacheRecord>(selectors: T, jsonPath = getDefaultSelectorsPath()): void {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(selectors, null, 2));
}

/** Merge non-null selector values into an existing cache object. */
export function mergeSelectorCache<T extends SelectorCacheRecord>(base: T, overrides: Partial<T>): T {
  const nextEntries = Object.entries(overrides).filter(([, value]) => value !== null && value !== undefined);
  return {
    ...base,
    ...Object.fromEntries(nextEntries),
  } as T;
}

/** Humanize a selector key into a semantic label for Stagehand. */
export function describeSelectorKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

async function getVisibleLocator(page: Page, selector: string, timeoutMs: number): Promise<Locator | null> {
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return locator;
  } catch {
    return null;
  }
}

/** Resolve a selector from cache first, then self-heal with Stagehand when it fails. */
export async function resolveSelector<T extends SelectorCacheRecord>(
  page: Page,
  key: SelectorCacheKey<T>,
  cached: T,
  options: ResolveSelectorOptions = {},
): Promise<Locator | null> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const cacheValue = cached[String(key)];

  if (typeof cacheValue === "string" && cacheValue.length > 0) {
    const cacheHit = await getVisibleLocator(page, cacheValue, timeoutMs);
    if (cacheHit) {
      console.log(`[SELECTOR] CACHE HIT for ${String(key)} -> ${cacheValue}`);
      return cacheHit;
    }
  }

  const stagehand = getActiveStagehand();
  if (!stagehand) {
    console.error(`[SELECTOR] No active Stagehand instance is available to resolve ${String(key)}.`);
    return null;
  }

  const semanticDescription = options.descriptions?.[String(key)] ?? describeSelectorKey(String(key));

  try {
    const actions = await observe(
      page,
      `Find the single best actionable element for "${semanticDescription}" on this page.`,
    );
    const resolvedSelector = actions.find((action) => typeof action.selector === "string" && action.selector.length > 0)?.selector;

    if (!resolvedSelector) {
      console.error(`[SELECTOR] Stagehand could not resolve ${String(key)}.`);
      return null;
    }

    const resolvedLocator = await getVisibleLocator(page, resolvedSelector, timeoutMs);
    if (!resolvedLocator) {
      console.error(`[SELECTOR] Stagehand returned a selector for ${String(key)}, but it did not become visible: ${resolvedSelector}`);
      return null;
    }

    const nextCached = {
      ...cached,
      [String(key)]: resolvedSelector,
      discoveryNote: `Stagehand refreshed ${String(key)} at ${new Date().toISOString()}`,
    } as T;

    Object.assign(cached, nextCached);
    saveSelectorCache(nextCached, options.jsonPath ?? getDefaultSelectorsPath());
    console.log(`[SELECTOR] STAGEHAND RESOLVED ${String(key)} -> ${resolvedSelector}`);
    return resolvedLocator;
  } catch (error: unknown) {
    console.error(
      `[SELECTOR] Stagehand resolution failed for ${String(key)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
