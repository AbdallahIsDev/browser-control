import type { Page } from "playwright";
import { retryAction, waitForAny, waitForElement } from "@bac/browser_core";
import { act } from "@bac/stagehand_core";
import { resolveSelector } from "@bac/selector_store";
import { getSelectors, getSelectorsPath, selectorDescriptions } from "@bac/selectors";

export interface FramerSkillResult {
  success: boolean;
  error?: string;
}

async function clickResolved(page: Page, key: keyof typeof selectorDescriptions): Promise<boolean> {
  const locator = await resolveSelector(page, key, getSelectors(), {
    descriptions: selectorDescriptions,
    jsonPath: getSelectorsPath(),
  });

  if (!locator) {
    return false;
  }

  return retryAction(async () => locator.click({ timeout: 3000 }), 2, 300)
    .then(() => true)
    .catch((error: unknown) => {
      console.error(`[FRAMER] Click failed for ${String(key)}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
}

async function runStagehand(page: Page, instruction: string): Promise<void> {
  await act(page, instruction);
}

function resultFromError(error: unknown): FramerSkillResult {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FRAMER] ${message}`);
  return { success: false, error: message };
}

/** Publish the current Framer project. */
export async function publishSite(page: Page): Promise<FramerSkillResult> {
  try {
    await page.bringToFront();
    console.log("[FRAMER] Starting publish workflow.");

    if (!(await clickResolved(page, "publishButton"))) {
      await runStagehand(page, "Click the Publish button in the Framer editor.");
    }

    console.log("[FRAMER] Waiting for publish confirmation.");
    await waitForAny(page, ["[role='dialog']", "button:has-text('Publish Site')", "button:has-text('Publish')"], 5000);

    if (!(await clickResolved(page, "publishConfirmButton"))) {
      await runStagehand(page, "Confirm the publish action in the open Framer modal.");
    }

    console.log("[FRAMER] Waiting for publication success.");
    const success = await waitForAny(
      page,
      ["text=/published/i", "[role='status']", "[role='alert']", "button:has-text('View Site')"],
      10000,
    );

    if (!success) {
      throw new Error("The publish success indicator did not appear.");
    }

    return { success: true };
  } catch (error: unknown) {
    return resultFromError(error);
  }
}

/** Open a named CMS collection from the Framer editor. */
export async function openCmsCollection(page: Page, collectionName: string): Promise<FramerSkillResult> {
  try {
    await page.bringToFront();
    console.log(`[FRAMER] Opening CMS collection "${collectionName}".`);

    if (!(await clickResolved(page, "cmsPanelButton"))) {
      await runStagehand(page, "Open the CMS panel in the Framer editor.");
    }

    await runStagehand(page, `Open the CMS collection named "${collectionName}".`);
    return { success: true };
  } catch (error: unknown) {
    return resultFromError(error);
  }
}

/** Switch the Framer preview breakpoint. */
export async function setResponsiveBreakpoint(
  page: Page,
  bp: "desktop" | "tablet" | "mobile",
): Promise<FramerSkillResult> {
  const keyMap = {
    desktop: "desktopBreakpointButton",
    tablet: "tabletBreakpointButton",
    mobile: "mobileBreakpointButton",
  } as const;

  try {
    await page.bringToFront();
    console.log(`[FRAMER] Switching breakpoint to ${bp}.`);

    if (!(await clickResolved(page, keyMap[bp]))) {
      await runStagehand(page, `Switch the Framer preview to the ${bp} breakpoint.`);
    }

    return { success: true };
  } catch (error: unknown) {
    return resultFromError(error);
  }
}

/** Open the Framer layer panel. */
export async function openLayerPanel(page: Page): Promise<FramerSkillResult> {
  try {
    await page.bringToFront();
    console.log("[FRAMER] Opening the layer panel.");

    if (!(await clickResolved(page, "layerPanelButton"))) {
      await runStagehand(page, "Open the Layers panel in the Framer editor.");
    }

    await waitForElement(page, getSelectors().mainCanvas ?? "canvas", 5000);
    return { success: true };
  } catch (error: unknown) {
    return resultFromError(error);
  }
}

/** Open the Framer style panel. */
export async function openStylePanel(page: Page): Promise<FramerSkillResult> {
  try {
    await page.bringToFront();
    console.log("[FRAMER] Opening the style panel.");

    if (!(await clickResolved(page, "stylePanelButton"))) {
      await runStagehand(page, "Open the Styles panel in the Framer editor.");
    }

    return { success: true };
  } catch (error: unknown) {
    return resultFromError(error);
  }
}
