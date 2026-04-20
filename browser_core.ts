import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from "playwright";
import { restoreContextCookies, saveContextCookies, type MemoryStore } from "./memory_store";
import { toPlaywrightProxySettings, type ProxyConfig } from "./proxy_manager";
import { createStealthContext } from "./stealth";
import type { Telemetry } from "./telemetry";
import { getChromeDebugPath } from "./paths";
import { logger } from "./logger";

const log = logger.withComponent("browser_core");

export interface DebugInteropState {
  port: number;
  bindAddress: string;
  windowsLoopbackUrl: string;
  localhostUrl: string;
  wslPreferredUrl: string | null;
  wslHostCandidates: string[];
  updatedAt: string;
}

export interface AutomationContextOptions {
  env?: NodeJS.ProcessEnv;
  enableStealth?: boolean;
  stealth?: boolean;
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
  fingerprintSeed?: string;
  seed?: string;
  proxy?: ProxyConfig | BrowserContextOptions["proxy"];
  memoryStore?: MemoryStore;
  sessionKey?: string;
  sessionTtlMs?: number;
  persistSessionCookies?: boolean;
}

interface DebugEndpointCandidateOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  metadata?: DebugInteropState | null;
  resolvConf?: string;
  routeTable?: string;
}

interface CaptchaSolverLike {
  waitForCaptcha(
    page: Page,
    selector?: string,
    timeoutMs?: number,
  ): Promise<unknown>;
}

interface ActionCaptchaOptions {
  autoSolveCaptcha?: boolean;
  captchaSolver?: CaptchaSolverLike;
  captchaSelector?: string;
  captchaTimeoutMs?: number;
  telemetry?: Telemetry;
}

const DEFAULT_DEBUG_HOST = "127.0.0.1";
const DEFAULT_LOCALHOST = "localhost";
const DEBUG_INTEROP_PATH = getChromeDebugPath();

function logActionError(action: string, selector: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`${action} failed for "${selector}": ${message}`);
}

function isLikelyWsl(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== "linux") {
    return false;
  }

  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP || os.release().toLowerCase().includes("microsoft"));
}

function toBaseUrl(hostOrUrl: string, port: number): string {
  const trimmed = hostOrUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  return `http://${trimmed}:${port}`;
}

function extractCandidateHost(hostOrUrl: string): string {
  const trimmed = hostOrUrl.trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      return "";
    }
  }

  return trimmed;
}

function isWslReachableHostCandidate(hostOrUrl: string): boolean {
  const host = extractCandidateHost(hostOrUrl);
  if (!host) {
    return false;
  }

  return host === DEFAULT_LOCALHOST || host.startsWith("127.") || isPrivateIpv4(host);
}

function pushUniqueCandidate(
  candidates: string[],
  value: string | null | undefined,
  port: number,
  options: { requireWslReachableHost?: boolean } = {},
): void {
  if (!value) {
    return;
  }

  if (options.requireWslReachableHost && !isWslReachableHostCandidate(value)) {
    return;
  }

  const normalized = toBaseUrl(value, port);
  if (!normalized || candidates.includes(normalized)) {
    return;
  }

  candidates.push(normalized);
}

function readDebugInteropState(): DebugInteropState | null {
  try {
    if (!fs.existsSync(DEBUG_INTEROP_PATH)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(DEBUG_INTEROP_PATH, "utf8")) as DebugInteropState;
  } catch {
    return null;
  }
}

function readLocalResolvConf(env: NodeJS.ProcessEnv): string {
  const resolvConfPath = env.BROWSER_DEBUG_RESOLV_CONF?.trim() || "/etc/resolv.conf";
  try {
    if (!fs.existsSync(resolvConfPath)) {
      return "";
    }

    return fs.readFileSync(resolvConfPath, "utf8");
  } catch {
    return "";
  }
}

function readLocalRouteTable(env: NodeJS.ProcessEnv): string {
  const routePath = env.BROWSER_DEBUG_ROUTE_TABLE?.trim() || "/proc/net/route";
  try {
    if (!fs.existsSync(routePath)) {
      return "";
    }

    return fs.readFileSync(routePath, "utf8");
  } catch {
    return "";
  }
}

function isPrivateIpv4(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value.trim());
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map((segment: string) => Number(segment));
  if (octets.some((octet: number) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function readNameserverCandidates(resolvConf: string): string[] {
  const matches = resolvConf.matchAll(/^\s*nameserver\s+([^\s#]+)\s*$/gim);
  const candidates: string[] = [];

  for (const match of matches) {
    const host = match[1]?.trim();
    if (!host || !isPrivateIpv4(host) || candidates.includes(host)) {
      continue;
    }

    candidates.push(host);
  }

  return candidates;
}

function decodeLittleEndianHexIp(value: string): string | null {
  if (!/^[0-9a-fA-F]{8}$/.test(value)) {
    return null;
  }

  const octets = value.match(/../g);
  if (!octets) {
    return null;
  }

  return octets
    .reverse()
    .map((octet) => String(parseInt(octet, 16)))
    .join(".");
}

export function readRouteGatewayCandidates(routeTable: string): string[] {
  const candidates: string[] = [];

  for (const line of routeTable.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Iface")) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts[1] !== "00000000") {
      continue;
    }

    const host = decodeLittleEndianHexIp(parts[2] ?? "");
    if (!host || !isPrivateIpv4(host) || candidates.includes(host)) {
      continue;
    }

    candidates.push(host);
  }

  return candidates;
}

export function getDebugEndpointCandidates(
  port = 9222,
  options: DebugEndpointCandidateOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const metadata = options.metadata === undefined ? readDebugInteropState() : options.metadata;
  const resolvConf = options.resolvConf ?? readLocalResolvConf(env);
  const routeTable = options.routeTable ?? readLocalRouteTable(env);

  if (env.BROWSER_DEBUG_URL?.trim()) {
    return [toBaseUrl(env.BROWSER_DEBUG_URL, port)];
  }

  const candidates: string[] = [];
  const isWsl = isLikelyWsl(env, platform);

  pushUniqueCandidate(candidates, env.BROWSER_DEBUG_HOST, port);

  if (isWsl) {
    pushUniqueCandidate(candidates, metadata?.wslPreferredUrl, port, { requireWslReachableHost: true });
    for (const host of metadata?.wslHostCandidates ?? []) {
      pushUniqueCandidate(candidates, host, port, { requireWslReachableHost: true });
    }
    for (const host of readRouteGatewayCandidates(routeTable)) {
      pushUniqueCandidate(candidates, host, port, { requireWslReachableHost: true });
    }
    for (const host of readNameserverCandidates(resolvConf)) {
      pushUniqueCandidate(candidates, host, port, { requireWslReachableHost: true });
    }
    pushUniqueCandidate(candidates, metadata?.localhostUrl ?? DEFAULT_LOCALHOST, port);
    pushUniqueCandidate(candidates, metadata?.windowsLoopbackUrl ?? DEFAULT_DEBUG_HOST, port);
    return candidates;
  }

  pushUniqueCandidate(candidates, metadata?.windowsLoopbackUrl ?? DEFAULT_DEBUG_HOST, port);
  pushUniqueCandidate(candidates, metadata?.localhostUrl ?? DEFAULT_LOCALHOST, port);
  pushUniqueCandidate(candidates, metadata?.wslPreferredUrl, port, { requireWslReachableHost: true });
  for (const host of metadata?.wslHostCandidates ?? []) {
    pushUniqueCandidate(candidates, host, port, { requireWslReachableHost: true });
  }
  for (const host of readRouteGatewayCandidates(routeTable)) {
    pushUniqueCandidate(candidates, host, port, { requireWslReachableHost: true });
  }
  for (const host of readNameserverCandidates(resolvConf)) {
    pushUniqueCandidate(candidates, host, port, { requireWslReachableHost: true });
  }

  return candidates;
}

async function isDebugEndpointReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveDebugEndpointUrl(port = 9222): Promise<string> {
  const candidates = getDebugEndpointCandidates(port);

  for (const candidate of candidates) {
    if (await isDebugEndpointReachable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `CDP port ${port} is not reachable from this environment. Tried: ${candidates.join(", ") || "no candidates"}`,
  );
}

function isStealthEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getFirstDefinedString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function resolveContextProxy(
  proxy: ProxyConfig | BrowserContextOptions["proxy"] | undefined,
): BrowserContextOptions["proxy"] | undefined {
  if (!proxy) {
    return undefined;
  }

  if ("url" in proxy) {
    return toPlaywrightProxySettings(proxy);
  }

  return proxy;
}

/** Connect to an already-running Chrome instance via CDP. */
export async function connectBrowser(port = 9222): Promise<Browser> {
  return chromium.connectOverCDP(await resolveDebugEndpointUrl(port));
}

/** Create a new automation-owned context with optional stealth hardening. */
export async function createAutomationContext(
  browser: Browser,
  options: AutomationContextOptions = {},
): Promise<BrowserContext> {
  const env = options.env ?? process.env;
  const contextProxy = resolveContextProxy(options.proxy);
  const stealthRequested = options.enableStealth
    ?? options.stealth
    ?? isStealthEnabled(env.ENABLE_STEALTH);
  let context: BrowserContext;

  if (stealthRequested) {
    context = await createStealthContext(browser, {
      env,
      locale: getFirstDefinedString(options.locale),
      timezoneId: getFirstDefinedString(options.timezoneId),
      userAgent: getFirstDefinedString(options.userAgent),
      fingerprintSeed: getFirstDefinedString(options.fingerprintSeed, options.seed),
      proxy: contextProxy,
    });
  } else {
    const contextOptions: Parameters<Browser["newContext"]>[0] = {};
    if (options.locale) {
      contextOptions.locale = options.locale;
    }
    if (options.timezoneId) {
      contextOptions.timezoneId = options.timezoneId;
    }
    if (options.userAgent) {
      contextOptions.userAgent = options.userAgent;
    }
    if (contextProxy) {
      contextOptions.proxy = contextProxy;
    }

    context = await browser.newContext(contextOptions);
  }

  await maybeRestoreSessionCookies(context, options);
  attachSessionCookiePersistence(context, options);
  return context;
}

/** Return every open page across all browser contexts. */
export function getAllPages(browser: Browser, context?: BrowserContext): Page[] {
  const contexts = context ? [context] : browser.contexts();
  return contexts.flatMap((entry: BrowserContext) => entry.pages());
}

/** Find the first page whose URL contains the provided pattern. */
export function findPageByUrl(browser: Browser, urlPattern: string, context?: BrowserContext): Page | null {
  return getAllPages(browser, context).find((page: Page) => page.url().includes(urlPattern)) ?? null;
}

/** Return a matching page or open a new tab if none exists. */
export async function getOrOpenPage(
  browser: Browser,
  urlPattern: string,
  openUrl: string,
  context?: BrowserContext,
): Promise<Page> {
  const existing = findPageByUrl(browser, urlPattern, context);
  if (existing) {
    await existing.bringToFront();
    return existing;
  }

  const targetContext = context ?? browser.contexts()[0] ?? (await browser.newContext());
  const page = await targetContext.newPage();
  await page.goto(openUrl, { waitUntil: "domcontentloaded" });
  return page;
}

/** Return the active Framer page or throw when it is missing. */
export function getFramerPage(browser: Browser, context?: BrowserContext): Page {
  const page = findPageByUrl(browser, "framer.com", context);
  if (!page) {
    throw new Error("No Framer tab was found. Open the Framer editor in the persistent Chrome session first.");
  }
  return page;
}

async function maybeSolveCaptcha(page: Page, options: ActionCaptchaOptions): Promise<boolean> {
  if (!options.autoSolveCaptcha || !options.captchaSolver) {
    return false;
  }

  const result = await options.captchaSolver.waitForCaptcha(
    page,
    options.captchaSelector,
    options.captchaTimeoutMs,
  );

  return result !== null && result !== undefined;
}

async function maybeRestoreSessionCookies(
  context: BrowserContext,
  options: AutomationContextOptions,
): Promise<void> {
  if (!options.memoryStore || !options.sessionKey) {
    return;
  }

  try {
    await restoreContextCookies(options.memoryStore, options.sessionKey, context);
  } catch (error: unknown) {
    log.error(`Failed to restore session cookies for "${options.sessionKey}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function attachSessionCookiePersistence(
  context: BrowserContext,
  options: AutomationContextOptions,
): void {
  if (!options.memoryStore || !options.sessionKey || options.persistSessionCookies === false) {
    return;
  }

  const saveCookies = async (): Promise<void> => {
    try {
      await saveContextCookies(
        options.memoryStore as MemoryStore,
        options.sessionKey as string,
        context,
        options.sessionTtlMs,
      );
    } catch (error: unknown) {
      log.error(`Failed to save session cookies for "${options.sessionKey}": ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const eventTarget = context as BrowserContext & {
    on?: (event: string, callback: () => void) => void;
  };

  if (typeof eventTarget.on === "function") {
    eventTarget.on("close", () => {
      void saveCookies();
    });
  }
}

/** Click with Playwright actionability checks and retry support. */
export async function smartClick(
  page: Page,
  selector: string,
  opts: { timeoutMs?: number; force?: boolean } & ActionCaptchaOptions = {},
): Promise<boolean> {
  const startedAt = Date.now();
  const performClick = async (): Promise<void> => {
    await page.locator(selector).first().click({
      timeout: opts.timeoutMs ?? 5000,
      force: opts.force,
    });
  };

  try {
    await performClick();
    await maybeSolveCaptcha(page, opts);
    opts.telemetry?.record("smartClick", "success", Date.now() - startedAt, {
      selector,
    });
    return true;
  } catch (error: unknown) {
    const solvedCaptcha = await maybeSolveCaptcha(page, opts);
    if (solvedCaptcha) {
      try {
        await performClick();
        opts.telemetry?.record("smartClick", "success", Date.now() - startedAt, {
          selector,
          recoveredByCaptcha: true,
        });
        return true;
      } catch (retryError: unknown) {
        opts.telemetry?.record("smartClick", "error", Date.now() - startedAt, {
          selector,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        logActionError("smartClick", selector, retryError);
        return false;
      }
    }

    opts.telemetry?.record("smartClick", "error", Date.now() - startedAt, {
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
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
  opts: { timeoutMs?: number; commit?: boolean } & ActionCaptchaOptions = {},
): Promise<boolean> {
  const startedAt = Date.now();
  const performFill = async (): Promise<void> => {
    const locator = page.locator(selector).first();
    await locator.click({ timeout: opts.timeoutMs ?? 3000 });
    await locator.fill(value, { timeout: opts.timeoutMs ?? 3000 });
    if (opts.commit ?? false) {
      await locator.press("Tab", { timeout: opts.timeoutMs ?? 3000 });
    }
  };

  try {
    await performFill();
    await maybeSolveCaptcha(page, opts);
    opts.telemetry?.record("smartFill", "success", Date.now() - startedAt, {
      selector,
    });
    return true;
  } catch (error: unknown) {
    const solvedCaptcha = await maybeSolveCaptcha(page, opts);
    if (solvedCaptcha) {
      try {
        await performFill();
        opts.telemetry?.record("smartFill", "success", Date.now() - startedAt, {
          selector,
          recoveredByCaptcha: true,
        });
        return true;
      } catch (retryError: unknown) {
        opts.telemetry?.record("smartFill", "error", Date.now() - startedAt, {
          selector,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        logActionError("smartFill", selector, retryError);
        return false;
      }
    }

    opts.telemetry?.record("smartFill", "error", Date.now() - startedAt, {
      selector,
      error: error instanceof Error ? error.message : String(error),
    });
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
    await resolveDebugEndpointUrl(port);
    return true;
  } catch (error: unknown) {
    log.error(`Debug port check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
