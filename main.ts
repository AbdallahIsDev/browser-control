import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Browser } from "playwright";
import { connectBrowser, getFramerPage, isDebugPortReady } from "@bac/browser_core";
import { connectStagehand, disconnectStagehand } from "@bac/stagehand_core";
import { publishSite } from "@bac/framer_skill";
import { discoverSelectors, getSelectors } from "@bac/selectors";

const setupSchema = z.object({
  cdp_port: z.number().default(9222),
});

/** Run the Framer automation demo against the persistent Chrome session. */
async function main(): Promise<void> {
  const setup = setupSchema.parse(JSON.parse(fs.readFileSync(path.join(process.cwd(), "setup.json"), "utf8")));

  if (!(await isDebugPortReady(setup.cdp_port))) {
    throw new Error(`CDP port ${setup.cdp_port} is not responding. Run launch_browser.bat first.`);
  }

  let browser: Browser | null = null;

  try {
    browser = await connectBrowser(setup.cdp_port);
    const page = getFramerPage(browser);
    await page.bringToFront();

    // Playwright and Stagehand attach through separate CDP clients, so keep their tab work sequenced.
    const stagehandConnection = await connectStagehand(setup.cdp_port, "framer.com");
    console.log(`[MAIN] Stagehand connected to ${stagehandConnection.page.url()}`);

    const selectorState = getSelectors();
    const loadedSelectors = selectorState.selectorsDiscovered ? selectorState : await discoverSelectors(page);
    console.log(`[MAIN] Selectors discovered: ${loadedSelectors.selectorsDiscovered}`);

    const result = await publishSite(page);
    console.log(`[MAIN] Publish result: ${JSON.stringify(result)}`);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await disconnectStagehand();
    if (browser) {
      /*
       * Playwright's CDP Browser handle has close(), which would terminate the shared Chrome process.
       * We intentionally leave the connection alone so the persistent browser session stays alive.
       */
      void browser;
    }
  }
}

void main();
