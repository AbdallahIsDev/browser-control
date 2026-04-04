/**
 * main.ts — PROJECT AUTOMATION SCRIPT
 * ─────────────────────────────────────────────────────────────────
 * This is where your actual automation logic lives.
 * Import from browser_core.ts for connection + fast actions.
 * Import from selectors.ts for element selectors.
 *
 * Run: npx ts-node main.ts
 * ─────────────────────────────────────────────────────────────────
 */

import fs from "node:fs";
import path from "node:path";
import {
  connectBrowser,
  findPageByUrl,
  fastClick,
  fastFill,
  waitForElement,
  screenshotElement,
  isDebugPortReady,
} from "../../browser_core";   // ← path to global browser_core.ts
import { selectors, discoverSelectors } from "./selectors";

const SETUP = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "setup.json"), "utf8"),
);

async function main(): Promise<void> {
  // ─── Health check ──────────────────────────────────────────────
  const ready = await isDebugPortReady(SETUP.cdp_port ?? 9222);
  if (!ready) {
    console.error(
      `CDP port ${SETUP.cdp_port ?? 9222} is not responding.\n` +
      "Run launch_browser.bat first, then retry.",
    );
    process.exit(1);
  }

  // ─── Connect ───────────────────────────────────────────────────
  const browser = await connectBrowser(SETUP.cdp_port ?? 9222);
  const page    = findPageByUrl(browser, SETUP.url_pattern);

  if (!page) {
    console.error(`No tab found matching: ${SETUP.url_pattern}`);
    console.error(`Open ${SETUP.target_url} in the debug Chrome window.`);
    await browser.close();
    process.exit(1);
  }

  await page.bringToFront();

  // ─── Ensure selectors are discovered ──────────────────────────
  const s = selectors.selectorsDiscovered
    ? selectors
    : await discoverSelectors(page);

  // ─── Your automation logic goes here ──────────────────────────
  console.log("Connected to:", page.url());
  console.log("Selectors ready:", s.selectorsDiscovered);

  // Example: click a button
  if (s.submitBtn) {
    const clicked = await fastClick(page, s.submitBtn);
    console.log("Submit clicked:", clicked);
  }

  // Example: fill an input
  if (s.usernameInput) {
    const filled = await fastFill(page, s.usernameInput, "my_username");
    console.log("Username filled:", filled);
  }

  // Example: wait for something to appear
  if (s.mainContent) {
    const appeared = await waitForElement(page, s.mainContent, 5000);
    console.log("Main content appeared:", appeared);
  }

  // Example: screenshot a specific element
  await screenshotElement(page, s.mainContent, "output/screenshot.png");

  await browser.close();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
