import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

function logActionError(action: string, selector: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[BROWSER_CORE] ${action} failed for "${selector}": ${message}`);
}

/** Connect to an already-running Chrome instance via CDP. */
export async function connectBrowser(port = 9222): Promise<Browser> {
  return chromium.connectOverCDP(`http://localhost:${port}`);
}

/** Return every open page across all browser contexts. */
export function getAllPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context: BrowserContext) => context.pages());
}

/** Find the first page whose URL contains the provided pattern. */
export function findPageByUrl(browser: Browser, urlPattern: string): Page | null {
  return getAllPages(browser).find((page: Page) => page.url().includes(urlPattern)) ?? null;
}

/** Return a matching page or open a new tab if none exists. */
export async function getOrOpenPage(browser: Browser, urlPattern: string, openUrl: string): Promise<Page> {
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

/** Return the active Framer page or throw when it is missing. */
export function getFramerPage(browser: Browser): Page {
  const page = findPageByUrl(browser, "framer.com");
  if (!page) {
    throw new Error("No Framer tab was found. Open the Framer editor in the persistent Chrome session first.");
  }
  return page;
}

/** Click with Playwright actionability checks and retry support. */
export async function smartClick(
  page: Page,
  selector: string,
  opts: { timeoutMs?: number; force?: boolean } = {},
): Promise<boolean> {
  try {
    await page.locator(selector).first().click({
      timeout: opts.timeoutMs ?? 5000,
      force: opts.force,
    });
    return true;
  } catch (error: unknown) {
    logActionError("smartClick", selector, error);
    return false;
  }
}

/** Click the DOM node directly without Playwright safety checks. */
export async function rawDomClick(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.evaluate((value: string) => {
      const element = document.querySelector<HTMLElement>(value);
      if (!element) {
        return false;
      }
      element.click();
      return true;
    }, selector);
  } catch (error: unknown) {
    logActionError("rawDomClick", selector, error);
    return false;
  }
}

/** Fill an input with locator.fill() and optionally commit with Tab. */
export async function smartFill(
  page: Page,
  selector: string,
  value: string,
  opts: { timeoutMs?: number; commit?: boolean } = {},
): Promise<boolean> {
  try {
    const locator = page.locator(selector).first();
    await locator.click({ timeout: opts.timeoutMs ?? 3000 });
    await locator.fill(value, { timeout: opts.timeoutMs ?? 3000 });
    if (opts.commit ?? false) {
      await locator.press("Tab", { timeout: opts.timeoutMs ?? 3000 });
    }
    return true;
  } catch (error: unknown) {
    logActionError("smartFill", selector, error);
    return false;
  }
}

/** Fill an input with keyboard events for controls that reject locator.fill(). */
export async function keyboardFill(page: Page, selector: string, value: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  try {
    await locator.focus({ timeout: 3000 });
    await page.keyboard.press("Control+A");
    await page.keyboard.type(value, { delay: 0 });
    return true;
  } catch (error: unknown) {
    logActionError("keyboardFill", selector, error);
    return false;
  }
}

/** Retry an async action with exponential back-off. */
export async function retryAction<T>(fn: () => Promise<T>, maxAttempts = 3, delayMs = 500): Promise<T> {
  let lastError: unknown;
  let nextDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, nextDelay));
      nextDelay *= 2;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Wait for a selector to become visible. */
export async function waitForElement(page: Page, selector: string, timeoutMs = 5000): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch (error: unknown) {
    logActionError("waitForElement", selector, error);
    return false;
  }
}

/** Return the first selector that becomes visible. */
export async function waitForAny(page: Page, selectors: string[], timeoutMs = 5000): Promise<string | null> {
  try {
    return await Promise.any(
      selectors.map(async (selector: string) => {
        await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
        return selector;
      }),
    );
  } catch {
    return null;
  }
}

/** Read the visible text content of the first matching element. */
export async function readText(page: Page, selector: string): Promise<string | null> {
  try {
    return await page.locator(selector).first().innerText({ timeout: 3000 });
  } catch (error: unknown) {
    logActionError("readText", selector, error);
    return null;
  }
}

/** Capture an element screenshot or fall back to the current viewport. */
export async function screenshotElement(page: Page, selector: string | null, outputPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (selector) {
    const locator: Locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.screenshot({ path: outputPath });
      return;
    }
  }
  await page.screenshot({ path: outputPath, fullPage: false });
}

/** Check whether the debug endpoint is currently reachable. */
export async function isDebugPortReady(port = 9222): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/json`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch (error: unknown) {
    console.error(`[BROWSER_CORE] Debug port check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
