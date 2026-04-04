/**
 * selectors.ts  — PROJECT-SPECIFIC selector file
 * ─────────────────────────────────────────────────────────────────
 * INSTRUCTIONS:
 *   1. Copy this file into your project folder
 *   2. Update SelectorMap with the elements YOUR site needs
 *   3. Update the discovery logic inside discoverSelectors()
 *   4. Run:  npx ts-node selectors.ts
 *      → This hits the live page once, fills selectors.json,
 *        then never runs discovery again until you delete the JSON
 * ─────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// ─── 1. Your selector map — edit these fields ─────────────────────────────────
export interface SelectorMap {
  // ← Add/remove fields to match what your site has
  loginBtn:         string | null;
  usernameInput:    string | null;
  passwordInput:    string | null;
  submitBtn:        string | null;
  mainContent:      string | null;
  errorAlert:       string | null;
  // Meta — do not remove
  selectorsDiscovered: boolean;
  discoveryNote:       string;
}

// ─── 2. Defaults — all null ───────────────────────────────────────────────────
const DEFAULT: SelectorMap = {
  loginBtn:         null,
  usernameInput:    null,
  passwordInput:    null,
  submitBtn:        null,
  mainContent:      null,
  errorAlert:       null,
  selectorsDiscovered: false,
  discoveryNote: "Not yet discovered.",
};

// ─── 3. Paths ─────────────────────────────────────────────────────────────────
const JSON_PATH     = path.join(process.cwd(), "selectors.json");
const SETUP_PATH    = path.join(process.cwd(), "setup.json");

// ─── 4. Load / save helpers ───────────────────────────────────────────────────
export function loadSelectors(): SelectorMap {
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(JSON_PATH, "utf8")) };
  } catch { return { ...DEFAULT }; }
}

function save(data: SelectorMap): void {
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

// ─── 5. Inline selectorOf — used inside page.evaluate() ──────────────────────
const SELECTOR_OF = `function selectorOf(el) {
  if (!el) return null;
  const dt  = el.getAttribute('data-test');   if (dt)  return '[data-test="'   + dt  + '"]';
  const dti = el.getAttribute('data-testid'); if (dti) return '[data-testid="' + dti + '"]';
  const al  = el.getAttribute('aria-label'); if (al)  return '[aria-label="'  + al  + '"]';
  if (el.id) return '#' + el.id;
  const cls = String(el.className||'').split(' ').filter(Boolean).slice(0,2).join('.');
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
}`;

// ─── 6. Discovery — EDIT THIS to match your site ─────────────────────────────
export async function discoverSelectors(page: import("playwright").Page): Promise<SelectorMap> {
  const existing = loadSelectors();
  if (existing.selectorsDiscovered) {
    console.log("Selectors already discovered — loading from JSON cache.");
    return existing;
  }

  console.log(`Discovering selectors on: ${page.url()}`);

  const found = await page.evaluate((selectorOfSrc: string) => {
    const selectorOf = new Function("el", selectorOfSrc.replace(/^function selectorOf\(el\)\s*/, ""));

    function byText(text: string, tag = "*"): Element | undefined {
      return Array.from(document.querySelectorAll(tag))
        .find((el) => (el as HTMLElement).innerText?.trim() === text);
    }
    function byPlaceholder(ph: string): HTMLInputElement | undefined {
      return Array.from(document.querySelectorAll("input"))
        .find((el) => el.placeholder?.toLowerCase().includes(ph.toLowerCase()));
    }

    // ── EDIT EVERYTHING BELOW THIS LINE to match your site's elements ──
    return {
      loginBtn:      selectorOf(byText("Log in", "button") ?? byText("Sign in", "button")),
      usernameInput: selectorOf(byPlaceholder("Username") ?? byPlaceholder("Email") ?? document.querySelector("input[type=email], input[name=username]")),
      passwordInput: selectorOf(byPlaceholder("Password") ?? document.querySelector("input[type=password]")),
      submitBtn:     selectorOf(byText("Submit", "button") ?? byText("Login", "button") ?? document.querySelector("[type=submit]")),
      mainContent:   selectorOf(document.querySelector("main") ?? document.querySelector("#content, #main, #app, #root")),
      errorAlert:    selectorOf(document.querySelector("[role=alert]") ?? document.querySelector(".error, .alert-danger, .alert-error")),
    };
  }, SELECTOR_OF) as Partial<SelectorMap>;

  const merged: SelectorMap = {
    ...existing,
    ...Object.fromEntries(Object.entries(found).filter(([, v]) => v !== null)),
    selectorsDiscovered: true,
    discoveryNote: `Discovered from ${page.url()} at ${new Date().toISOString()}`,
  } as SelectorMap;

  save(merged);
  console.log("Selectors saved to", JSON_PATH);
  console.log(JSON.stringify(merged, null, 2));
  return merged;
}

// ─── 7. Singleton export (loads from JSON at import time) ─────────────────────
export const selectors: SelectorMap = loadSelectors();

// ─── 8. Run directly to trigger discovery ─────────────────────────────────────
//     Run: npx ts-node selectors.ts
if (require.main === module) {
  (async () => {
    const setup = JSON.parse(fs.readFileSync(SETUP_PATH, "utf8"));
    const browser = await chromium.connectOverCDP(`http://localhost:${setup.cdp_port ?? 9222}`);
    const page =
      browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes(setup.url_pattern))
      ?? null;

    if (!page) {
      console.error(`No tab found matching: ${setup.url_pattern}`);
      console.error("Open the target site in the debug Chrome window first.");
      process.exit(1);
    }

    await page.bringToFront();
    await discoverSelectors(page);
    await browser.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
