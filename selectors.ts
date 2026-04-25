import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Page } from "playwright";
import { connectBrowser, getFramerPage } from "./browser_core";
import {
  loadSelectorCache,
  mergeSelectorCache,
  saveSelectorCache,
  type SelectorCacheRecord,
} from "./selector_store";
import { logger } from "./logger";

const log = logger.withComponent("selectors");

const setupSchema = z.object({
  cdp_port: z.number().default(9222),
  selectors_file: z.string().default("selectors.json"),
});

type SetupConfig = z.infer<typeof setupSchema>;

let cachedSetup: SetupConfig | null = null;
let cachedSelectors: FramerSelectorMap | null = null;

function getSetup(): SetupConfig {
  if (!cachedSetup) {
    cachedSetup = setupSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "setup.json"), "utf8")));
  }
  return cachedSetup;
}

export interface FramerSelectorMap extends SelectorCacheRecord {
  publishButton: string | null;
  publishConfirmButton: string | null;
  cmsPanelButton: string | null;
  layerPanelButton: string | null;
  stylePanelButton: string | null;
  desktopBreakpointButton: string | null;
  tabletBreakpointButton: string | null;
  mobileBreakpointButton: string | null;
  collectionSearchInput: string | null;
  successToast: string | null;
  mainCanvas: string | null;
}

const DEFAULT_SELECTORS: FramerSelectorMap = {
  publishButton: null,
  publishConfirmButton: null,
  cmsPanelButton: null,
  layerPanelButton: null,
  stylePanelButton: null,
  desktopBreakpointButton: null,
  tabletBreakpointButton: null,
  mobileBreakpointButton: null,
  collectionSearchInput: null,
  successToast: null,
  mainCanvas: null,
  selectorsDiscovered: false,
  discoveryNote: "Framer selectors have not been discovered yet.",
};

export function getSelectorsPath(): string {
  return path.join(process.cwd(), getSetup().selectors_file);
}

export const selectorDescriptions: Record<Exclude<keyof FramerSelectorMap, "selectorsDiscovered" | "discoveryNote">, string> = {
  publishButton: "the Framer Publish button",
  publishConfirmButton: "the Framer publish confirmation button",
  cmsPanelButton: "the Framer CMS panel button",
  layerPanelButton: "the Framer layers panel button",
  stylePanelButton: "the Framer styles panel button",
  desktopBreakpointButton: "the desktop breakpoint toggle",
  tabletBreakpointButton: "the tablet breakpoint toggle",
  mobileBreakpointButton: "the mobile breakpoint toggle",
  collectionSearchInput: "the CMS collection search input",
  successToast: "the Framer success confirmation message",
  mainCanvas: "the main Framer editor canvas",
};

/** Load the current Framer selector cache from disk. */
export function loadSelectors(): FramerSelectorMap {
  return loadSelectorCache(DEFAULT_SELECTORS, getSelectorsPath());
}

/** Return the cached Framer selector cache, loading it lazily when needed. */
export function getSelectors(): FramerSelectorMap {
  if (!cachedSelectors) {
    cachedSelectors = loadSelectors();
  }
  return cachedSelectors;
}

export function invalidateSelectorsCache(): void {
  cachedSelectors = null;
}

/** Discover initial Framer selectors without using dynamic code evaluation hacks. */
export async function discoverSelectors(page: Page): Promise<FramerSelectorMap> {
  invalidateSelectorsCache();
  const existing = getSelectors();
  if (existing.selectorsDiscovered) {
    log.info("Using cached Framer selectors.");
    return existing;
  }

  const found = await page.evaluate(() => {
    const byExactText = (text: string, selector = "button, [role='button'], a"): Element | null =>
      Array.from(document.querySelectorAll(selector)).find((element) => {
        const rendered = (element as HTMLElement).innerText?.trim();
        return rendered === text;
      }) ?? null;

    const byAriaLabel = (value: string): Element | null =>
      document.querySelector(`[aria-label="${value}"]`);

    const byPlaceholder = (value: string): Element | null =>
      Array.from(document.querySelectorAll("input, textarea")).find((element) => {
        return (element as HTMLInputElement).placeholder?.toLowerCase().includes(value.toLowerCase());
      }) ?? null;

    const selectorFrom = (element: Element | null): string | null => {
      if (!element) {
        return null;
      }
      const dataTest = element.getAttribute("data-test");
      if (dataTest) {
        return `[data-test="${dataTest}"]`;
      }
      const dataTestId = element.getAttribute("data-testid");
      if (dataTestId) {
        return `[data-testid="${dataTestId}"]`;
      }
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) {
        return `[aria-label="${ariaLabel}"]`;
      }
      const htmlElement = element as HTMLElement;
      if (htmlElement.id) {
        return `#${htmlElement.id}`;
      }
      const className = String(htmlElement.className ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
    };

    return {
      publishButton: selectorFrom(byExactText("Publish")),
      publishConfirmButton: selectorFrom(byExactText("Publish Site") ?? byExactText("Confirm Publish") ?? byExactText("Publish")),
      cmsPanelButton: selectorFrom(byAriaLabel("CMS") ?? byExactText("CMS")),
      layerPanelButton: selectorFrom(byAriaLabel("Layers") ?? byExactText("Layers")),
      stylePanelButton: selectorFrom(byAriaLabel("Styles") ?? byExactText("Styles")),
      desktopBreakpointButton: selectorFrom(byAriaLabel("Desktop") ?? byExactText("Desktop")),
      tabletBreakpointButton: selectorFrom(byAriaLabel("Tablet") ?? byExactText("Tablet")),
      mobileBreakpointButton: selectorFrom(byAriaLabel("Mobile") ?? byExactText("Mobile")),
      collectionSearchInput: selectorFrom(byPlaceholder("Search")),
      successToast: selectorFrom(document.querySelector("[role='status'], [role='alert']")),
      mainCanvas: selectorFrom(document.querySelector("canvas") ?? document.querySelector("[data-testid='canvas-root']")),
    };
  });

  const merged = mergeSelectorCache(existing, {
    ...(found as Partial<FramerSelectorMap>),
    selectorsDiscovered: true,
    discoveryNote: `Framer selectors discovered from ${page.url()} at ${new Date().toISOString()}`,
  });

  cachedSelectors = merged;
  saveSelectorCache(merged, getSelectorsPath());
  log.info(`Saved Framer selectors to ${getSelectorsPath()}`);
  return merged;
}

if (require.main === module) {
  (async () => {
    const browser = await connectBrowser(getSetup().cdp_port);
    const page = getFramerPage(browser);
    await page.bringToFront();
    await discoverSelectors(page);
  })().catch((error: unknown) => {
    log.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
