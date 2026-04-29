/**
 * Ref Store — Per-session ref assignment, lookup, and invalidation
 *
 * Manages the mapping between compact refs (e1, e2, ...) and their
 * corresponding A11yElement data. Refs are session-local and
 * page-local — they are invalidated when the page URL changes
 * or when a new snapshot is generated.
 */

import type { Page } from "playwright";
import { logger } from "./shared/logger";
import type { A11yElement, A11ySnapshot } from "./a11y_snapshot";

const log = logger.withComponent("ref_store");

interface StoredSnapshot {
  snapshot: A11ySnapshot;
  refMap: Map<string, A11yElement>;
  pageUrl: string;
}

/**
 * Per-session ref store. Tracks the latest snapshot and provides
 * fast ref lookup. Refs are invalidated on page URL change.
 */
export class RefStore {
  private store = new Map<string, StoredSnapshot>();

  setSnapshot(pageId: string, snapshot: A11ySnapshot): void {
    const refMap = new Map<string, A11yElement>();
    for (const el of snapshot.elements) {
      refMap.set(el.ref, el);
    }

    const previous = this.store.get(pageId);
    if (previous && previous.pageUrl !== snapshot.pageUrl) {
      log.info(
        `Page URL changed for "${pageId}": ${previous.pageUrl} → ${snapshot.pageUrl}. Refs invalidated.`,
      );
    }

    this.store.set(pageId, { snapshot, refMap, pageUrl: snapshot.pageUrl ?? "" });

    log.info(
      `Stored snapshot for "${pageId}": ${snapshot.elements.length} elements, refs e1..e${snapshot.elements.length}`,
    );
  }

  lookup(pageId: string, ref: string): A11yElement | undefined {
    const stored = this.store.get(pageId);
    if (!stored) {
      log.warn(`No snapshot stored for page "${pageId}"`);
      return undefined;
    }
    const cleanRef = ref.startsWith("@") ? ref.slice(1) : ref;
    return stored.refMap.get(cleanRef);
  }

  getSnapshot(pageId: string): A11ySnapshot | undefined {
    return this.store.get(pageId)?.snapshot;
  }

  getRefMap(pageId: string): Map<string, A11yElement> | undefined {
    return this.store.get(pageId)?.refMap;
  }

  hasRef(pageId: string, ref: string): boolean {
    const cleanRef = ref.startsWith("@") ? ref.slice(1) : ref;
    return this.store.get(pageId)?.refMap.has(cleanRef) ?? false;
  }

  invalidate(pageId: string): void {
    if (this.store.has(pageId)) {
      this.store.delete(pageId);
      log.info(`Invalidated all refs for page "${pageId}"`);
    }
  }

  invalidateIfUrlChanged(pageId: string, currentUrl: string): boolean {
    const stored = this.store.get(pageId);
    if (!stored) return false;
    if (stored.pageUrl !== currentUrl) {
      this.store.delete(pageId);
      log.info(`Invalidated refs for "${pageId}" — URL changed: ${stored.pageUrl} → ${currentUrl}`);
      return true;
    }
    return false;
  }

  invalidateAll(): void {
    const count = this.store.size;
    this.store.clear();
    log.info(`Invalidated all ${count} page snapshot(s)`);
  }

  listPages(): string[] {
    return Array.from(this.store.keys());
  }

  get size(): number {
    return this.store.size;
  }
}

export function getPageId(url: string, sessionId?: string): string {
  if (sessionId) return `${sessionId}:${url}`;
  return url;
}

// ── Ref Resolution Bridge ───────────────────────────────────────────

export interface RefResolutionResult {
  element: A11yElement;
  selector: string;
  syntheticFallback: boolean;
  hasBounds: boolean;
  description: string;
}

export interface ResolveRefOptions {
  preferCDP?: boolean;
  fallbackStrategy?: "aria" | "text" | "coords";
}

export async function resolveRefTarget(
  store: RefStore,
  pageId: string,
  ref: string,
  page?: Page,
  options: ResolveRefOptions = {},
): Promise<RefResolutionResult | null> {
  const element = store.lookup(pageId, ref);
  if (!element) {
    log.warn(`Ref "${ref}" not found in store for page "${pageId}"`);
    return null;
  }

  let selector = element.selector ?? "";
  let isSynthetic = false;

  if (!selector) {
    selector = buildFallbackSelector(element, options.fallbackStrategy ?? "aria");
    isSynthetic = true;
  }

  return {
    element,
    selector,
    syntheticFallback: isSynthetic,
    hasBounds: Boolean(element.bounds),
    description: buildRefDescription(element),
  };
}

function buildFallbackSelector(element: A11yElement, strategy: "aria" | "text" | "coords"): string {
  switch (strategy) {
    case "aria":
      if (element.selector) {
        return element.selector;
      }
      if (element.name && element.role) {
        return `role=${element.role}[name="${escapeSelectorValue(element.name)}"]`;
      }
      if (element.text && element.role) {
        return `role=${element.role}[name="${escapeSelectorValue(element.text)}"]`;
      }
      if (element.name) {
        return `:text-is("${escapeSelectorValue(element.name)}")`;
      }
      if (element.role) {
        return `role=${element.role}`;
      }
      break;
    case "text":
      if (element.selector) {
        return element.selector;
      }
      if (element.text) {
        return `:text-is("${escapeSelectorValue(element.text.slice(0, 50))}")`;
      }
      if (element.name) {
        return `:text-is("${escapeSelectorValue(element.name)}")`;
      }
      break;
    case "coords":
      if (element.bounds) {
        return `data-coords="${element.bounds.x},${element.bounds.y}"`;
      }
      break;
  }
  return element.role ? `[role="${element.role}"]` : "";
}

function buildRefDescription(element: A11yElement): string {
  const parts: string[] = [];
  parts.push(`[${element.role}]`);
  if (element.name) parts.push(`"${element.name}"`);
  if (element.disabled) parts.push("(disabled)");
  if (element.checked !== undefined) parts.push(element.checked ? "(checked)" : "(unchecked)");
  return parts.join(" ");
}

function escapeSelectorValue(value: string): string {
  return value.replace(/"/g, "'").replace(/\n/g, " ").replace(/\t/g, " ").trim().slice(0, 100);
}

export async function resolveRefLocator(
  store: RefStore,
  pageId: string,
  page: Page,
  ref: string,
  options: ResolveRefOptions = {},
): Promise<{
  locator: import("playwright").Locator;
  element: A11yElement;
  syntheticFallback: boolean;
  description: string;
} | null> {
  const result = await resolveRefTarget(store, pageId, ref, page, options);
  if (!result) return null;

  const locator = await buildLocatorFromElement(page, result.element);
  if (!locator) return null;

  return {
    locator,
    element: result.element,
    syntheticFallback: result.syntheticFallback,
    description: result.description,
  };
}

export function resolveRefBounds(
  store: RefStore,
  pageId: string,
  ref: string,
): { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number; deviceScaleFactor?: number } | null {
  const element = store.lookup(pageId, ref);
  if (!element) {
    return null;
  }
  if (!element.bounds) {
    return null;
  }
  // Return the full ElementBounds with viewport metadata
  return element.bounds;
}

/**
 * Classify whether a stored selector is "specific enough" to be trusted
 * as a single-match locator. Generic selectors (bare tag names, etc.)
 * are NOT specific enough to outrank semantic candidates.
 */
function isSelectorSpecificEnough(selector: string): boolean {
  // Strip leading/trailing whitespace
  const s = selector.trim();

  // Must have at least one distinguishing attribute
  // Pure tag names (button, a, input) are generic
  if (/^(?:button|a|input|textarea|select|div|span|p|li|tr|td|th)$/i.test(s)) {
    return false;
  }

  // Must have either:
  // - An ID: #my-id
  // - A data attribute: [data-testid=...], [aria-label=...]
  // - A class with meaningful content: .my-class (not just .a, .b)
  // - A compound selector with role+name
  const hasId = s.includes("#");
  const hasDataAttr = /\[data-[a-z]+=/i.test(s) || /\[aria-label=/i.test(s);
  const hasClassWithContent = /\.[a-z][a-z0-9_-]*[a-z0-9]/i.test(s);
  const hasRoleAttr = /\[role=/i.test(s);

  return hasId || hasDataAttr || hasClassWithContent || hasRoleAttr;
}

/**
 * Build a Playwright Locator from an A11yElement.
 *
 * Resolution order (most specific first):
 * 1. exact getByRole(role, { name, exact: true }) — most reliable
 * 2. exact getByRole(role, { name: text, exact: true }) — name vs text fallback
 * 3. exact getByText(name) — text-only match
 * 4. exact getByText(text) — text fallback
 * 5. stored selector (ONLY if specific enough and matches exactly 1 element)
 *
 * If a stored selector is generic and matches multiple elements, return null
 * instead of silently picking the wrong element. This prevents duplicate-target
 * bugs on pages with multiple matching elements.
 */
async function buildLocatorFromElement(
  page: Page,
  element: A11yElement,
): Promise<import("playwright").Locator | null> {
  // Phase 1: Semantic candidates (highest priority)
  if (element.role && element.name) {
    const locator = page.getByRole(element.role as Parameters<Page["getByRole"]>[0], {
      name: element.name,
      exact: true,
    });
    if (await locator.count() === 1) {
      return locator;
    }
  }

  if (element.role && element.text) {
    const locator = page.getByRole(element.role as Parameters<Page["getByRole"]>[0], {
      name: element.text,
      exact: true,
    });
    if (await locator.count() === 1) {
      return locator;
    }
  }

  if (element.name) {
    const locator = page.getByText(element.name, { exact: true });
    if (await locator.count() === 1) {
      return locator;
    }
  }

  if (element.text) {
    const locator = page.getByText(element.text, { exact: true });
    if (await locator.count() === 1) {
      return locator;
    }
  }

  // Phase 2: Stored selector as last resort
  // ONLY use it if it is specific enough AND matches exactly 1 element.
  // Generic selectors like "button" or "div" are NOT trusted.
  if (element.selector) {
    if (isSelectorSpecificEnough(element.selector)) {
      const locator = page.locator(element.selector);
      const count = await locator.count();
      if (count === 1) {
        return locator;
      }
      // Multiple matches with generic selector — fail clearly instead of
      // silently returning the first one (duplicate-target bug prevention)
      if (count > 1) {
        log.warn(
          `Stored selector "${element.selector}" matches ${count} elements — refusing to pick one. ` +
          `Use getByRole/getByText with exact name instead.`,
        );
        return null;
      }
    } else {
      // Selector is too generic to trust — skip it
      log.debug(
        `Stored selector "${element.selector}" is generic (${element.role || "no role"}) ` +
        `and skipped in favor of semantic locators.`,
      );
    }
  }

  // No unique match found
  return null;
}
