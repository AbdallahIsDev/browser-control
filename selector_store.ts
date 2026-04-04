/**
 * selector_store.ts
 * ─────────────────────────────────────────────────────────────────
 * Generic selector caching system. Copy this pattern into every
 * new project. Replace the SelectorMap interface and discovery
 * logic with whatever is needed for that specific site.
 *
 * SPEED RULE: Discovery only runs ONCE per site. After the JSON
 * cache file is written with selectorsDiscovered:true, the code
 * reads from the JSON file only — never hits the DOM again on
 * every cycle. This makes repeated automation cycles instant.
 * ─────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";

// ─── 1. Define your selector map here ────────────────────────────────────────
//     Replace this interface with the elements your project actually needs.
//     Keep null as the default — discovery will fill them in.

export interface SelectorMap {
  // Generic interactive elements
  primaryActionBtn:  string | null;
  secondaryActionBtn: string | null;
  mainInput:         string | null;
  searchInput:       string | null;
  confirmBtn:        string | null;
  cancelBtn:         string | null;
  // Data display
  mainContainer:     string | null;
  dataTable:         string | null;
  dataRow:           string | null;
  // Feedback
  toastContainer:    string | null;
  errorMessage:      string | null;
  loadingIndicator:  string | null;
  // Meta
  selectorsDiscovered: boolean;
  discoveryNote:       string;
}

// ─── 2. Set defaults (all null except meta) ───────────────────────────────────

const DEFAULT_SELECTORS: SelectorMap = {
  primaryActionBtn:  null,
  secondaryActionBtn: null,
  mainInput:         null,
  searchInput:       null,
  confirmBtn:        null,
  cancelBtn:         null,
  mainContainer:     null,
  dataTable:         null,
  dataRow:           null,
  toastContainer:    null,
  errorMessage:      null,
  loadingIndicator:  null,
  selectorsDiscovered: false,
  discoveryNote: "Discovery has not run yet for this project.",
};

// ─── 3. Path to this project's JSON cache ─────────────────────────────────────
//     Change this to match your project folder.

const SELECTORS_PATH = path.join(process.cwd(), "selectors.json");

// ─── 4. Load from JSON cache (runs at module import time) ─────────────────────

export function loadSelectors(jsonPath = SELECTORS_PATH): SelectorMap {
  try {
    return {
      ...DEFAULT_SELECTORS,
      ...(JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Partial<SelectorMap>),
    };
  } catch {
    return { ...DEFAULT_SELECTORS };
  }
}

// ─── 5. Save to JSON cache ────────────────────────────────────────────────────

export function saveSelectors(
  selectors: SelectorMap,
  jsonPath = SELECTORS_PATH,
): void {
  fs.writeFileSync(jsonPath, JSON.stringify(selectors, null, 2));
}

// ─── 6. Merge helper — only overwrite if new value is not null ─────────────────

export function mergeSelectors(
  base: SelectorMap,
  overrides: Partial<SelectorMap>,
): SelectorMap {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== null && v !== undefined),
    ),
  } as SelectorMap;
}

// ─── 7. The selector shortcut helper for fast actions ────────────────────────
//     Call selectorOf(el) inside page.evaluate() to extract the best selector.
//     Priority: data-test → data-testid → aria-label → id → class

export const SELECTOR_OF_FN = `
function selectorOf(el) {
  if (!el) return null;
  const dt  = el.getAttribute('data-test');    if (dt)  return '[data-test="'    + dt  + '"]';
  const dti = el.getAttribute('data-testid'); if (dti) return '[data-testid="'  + dti + '"]';
  const al  = el.getAttribute('aria-label');  if (al)  return '[aria-label="'   + al  + '"]';
  if (el.id) return '#' + el.id;
  const cls = String(el.className||'').split(' ').filter(Boolean).slice(0,2).join('.');
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
}
`;

// ─── 8. Discovery function — EDIT THIS for each project ──────────────────────
//     This is the only function you rewrite per project.
//     It runs once, fills in selectors, saves the JSON, and never runs again.

export async function discoverSelectors(
  page: Page,
  jsonPath = SELECTORS_PATH,
): Promise<SelectorMap> {
  const existing = loadSelectors(jsonPath);

  // Skip discovery if already done
  if (existing.selectorsDiscovered) {
    return existing;
  }

  const discovered = await page.evaluate((selectorOfFn: string) => {
    // Inject the selectorOf helper
    const fn = new Function("return " + selectorOfFn.replace(/^function selectorOf/, "function"))();

    function byText(text: string, tag = "*"): Element | undefined {
      return Array.from(document.querySelectorAll(tag))
        .find((el) => (el as HTMLElement).innerText?.trim() === text);
    }
    function byPlaceholder(text: string): HTMLInputElement | undefined {
      return Array.from(document.querySelectorAll("input"))
        .find((el) => el.placeholder?.toLowerCase().includes(text.toLowerCase()));
    }
    function byRole(role: string): Element | undefined {
      return document.querySelector(`[role="${role}"]`) ?? undefined;
    }

    // ── Replace the logic below with discovery specific to your target site ──
    return {
      primaryActionBtn:  fn(byText("Submit", "button") ?? byText("Save", "button") ?? byText("Continue", "button")),
      secondaryActionBtn: fn(byText("Cancel", "button") ?? byText("Back", "button")),
      mainInput:         fn(byPlaceholder("Search") ?? byPlaceholder("Enter") ?? document.querySelector("input:not([type=hidden])")),
      searchInput:       fn(byPlaceholder("Search") ?? document.querySelector("[type=search]")),
      confirmBtn:        fn(byText("Confirm", "button") ?? byText("OK", "button") ?? byText("Yes", "button")),
      cancelBtn:         fn(byText("Cancel", "button") ?? byText("No", "button") ?? byText("Close", "button")),
      mainContainer:     fn(byRole("main") ?? document.querySelector("main") ?? document.querySelector("#app, #root, #__next")),
      dataTable:         fn(document.querySelector("table") ?? document.querySelector("[role=grid]")),
      dataRow:           fn(document.querySelector("tr:not(:first-child)") ?? document.querySelector("[role=row]")),
      toastContainer:    fn(document.querySelector("[role=alert]") ?? document.querySelector(".toast, .notification, .snackbar")),
      errorMessage:      fn(document.querySelector("[role=alert][aria-live=assertive]") ?? document.querySelector(".error, .alert-danger")),
      loadingIndicator:  fn(document.querySelector("[role=progressbar]") ?? document.querySelector(".loading, .spinner")),
    };
  }, SELECTOR_OF_FN) as Partial<SelectorMap>;

  const merged = mergeSelectors(existing, {
    ...discovered,
    selectorsDiscovered: true,
    discoveryNote: `Selectors discovered from ${page.url()} at ${new Date().toISOString()}`,
  });

  saveSelectors(merged, jsonPath);
  return merged;
}

// ─── 9. In-memory singleton — import this in your project scripts ─────────────
//     It loads from JSON at import time (instant, no network call).
//     Re-run discoverSelectors() only if selectorsDiscovered is false.

export const selectors: SelectorMap = loadSelectors();
export { SELECTORS_PATH };
