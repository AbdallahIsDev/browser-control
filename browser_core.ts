/**
 * browser_core.ts
 * ─────────────────────────────────────────────────────────────────
 * Global reusable browser connection utilities.
 * Works with any Chromium-based browser on any debug port.
 *
 * Speed philosophy:
 *   • Always connect to an already-open browser (never launch inside TS)
 *   • Find tabs by URL pattern — never by title (titles change constantly)
 *   • All waits use condition-based polling, never fixed timeouts
 *   • Clicks go through page.evaluate() → el.click() when possible
 *     (skips Playwright's retry/scroll overhead for known-good selectors)
 *   • Inputs use triple-click + keyboard.type with delay:0 (fastest fill)
 * ─────────────────────────────────────────────────────────────────
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

// ─── Connection ───────────────────────────────────────────────────────────────

/**
 * Connect to an already-running Chrome/Chromium instance via CDP.
 * Run launch_browser.bat first to bind the debug port.
 */
export async function connectBrowser(port = 9222): Promise<Browser> {
  return chromium.connectOverCDP(`http://localhost:${port}`);
}

/**
 * Get all open pages across all contexts in the connected browser.
 */
export function getAllPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((ctx: BrowserContext) => ctx.pages());
}

/**
 * Find a page whose URL contains the given pattern.
 * Uses URL matching — NEVER title matching (titles change constantly).
 *
 * @param urlPattern  e.g. "exness.com/webtrading" or "github.com"
 */
export function findPageByUrl(browser: Browser, urlPattern: string): Page | null {
  return (
    getAllPages(browser).find((p) => p.url().includes(urlPattern)) ?? null
  );
}

/**
 * Find a page by URL, or open a new tab navigating to `openUrl` if not found.
 * Returns the existing or newly created page.
 */
export async function getOrOpenPage(
  browser: Browser,
  urlPattern: string,
  openUrl: string,
): Promise<Page> {
  const existing = findPageByUrl(browser, urlPattern);
  if (existing) {
    await existing.bringToFront();
    return existing;
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.goto(openUrl, { waitUntil: "domcontentloaded" });
  return page;
}

// ─── Fast Actions ─────────────────────────────────────────────────────────────

/**
 * Click an element using the fastest available method.
 *
 * Speed order:
 *   1. page.evaluate() → el.click()        — zero overhead, synchronous DOM click
 *   2. page.locator(sel).click()            — Playwright click with retry logic
 *   3. Returns false if both fail
 *
 * Use this for buttons and links where you have a known selector.
 */
export async function fastClick(
  page: Page,
  selector: string,
  opts: { timeout?: number; force?: boolean } = {},
): Promise<boolean> {
  // Method 1: direct DOM click (fastest — no Playwright retry overhead)
  const clicked = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) { el.click(); return true; }
    return false;
  }, selector).catch(() => false);

  if (clicked) return true;

  // Method 2: Playwright locator (handles visibility, scrolling, retries)
  try {
    await page
      .locator(selector)
      .first()
      .click({ timeout: opts.timeout ?? 5000, force: opts.force });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill an input field as fast as possible.
 *
 * Strategy:
 *   1. Focus the element
 *   2. Ctrl+A to select all existing content
 *   3. Type the new value with delay:0 (no artificial keystroke delay)
 *
 * This is faster than page.fill() because it skips the internal clear step
 * that Playwright does via triple-click, which can cause React re-renders.
 */
export async function fastFill(
  page: Page,
  selector: string,
  value: string,
): Promise<boolean> {
  try {
    const el = page.locator(selector).first();
    await el.focus({ timeout: 3000 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type(value, { delay: 0 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for an element to appear in the DOM.
 * Condition-based — never uses a fixed timeout.
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for any one of multiple selectors to appear.
 * Returns the selector that appeared first, or null if none did.
 */
export async function waitForAny(
  page: Page,
  selectors: string[],
  timeoutMs = 5000,
): Promise<string | null> {
  const result = await Promise.race(
    selectors.map((sel) =>
      page
        .waitForSelector(sel, { state: "visible", timeout: timeoutMs })
        .then(() => sel)
        .catch(() => null),
    ),
  );
  return result ?? null;
}

/**
 * Read the visible text content of an element.
 * Returns null if element not found.
 */
export async function readText(page: Page, selector: string): Promise<string | null> {
  try {
    return await page.locator(selector).first().innerText({ timeout: 3000 });
  } catch {
    return null;
  }
}

/**
 * Take a fast screenshot of a specific element only (not the full page).
 * Falls back to a viewport screenshot if the element is not found.
 */
export async function screenshotElement(
  page: Page,
  selector: string | null,
  outputPath: string,
): Promise<void> {
  if (selector) {
    const el = page.locator(selector).first();
    const count = await el.count().catch(() => 0);
    if (count > 0) {
      await el.screenshot({ path: outputPath });
      return;
    }
  }
  // Fallback: viewport-only screenshot (much faster than fullPage: true)
  await page.screenshot({ path: outputPath, fullPage: false });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Check if the debug endpoint is responding.
 * Use this for the health check (HC-2) before connecting.
 */
export async function isDebugPortReady(port = 9222): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/json`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
