import type { Page } from "playwright";
import type { Skill, SkillContext, SkillManifest } from "../skill";

const manifest: SkillManifest = {
  name: "adobe_stock",
  version: "1.0.0",
  description: "Automates Adobe Stock contributor operations: upload, tag, submit, check status.",
  author: "browser-control",
  requiredEnv: ["OPENROUTER_API_KEY"],
  allowedDomains: ["stock.adobe.com", "contributor.stock.adobe.com"],
  actions: [
    {
      name: "navigateToUpload",
      description: "Navigate to the Adobe Stock upload page.",
      params: [],
    },
    {
      name: "submitMetadata",
      description: "Submit metadata (title, keywords, category) for an uploaded asset.",
      params: [
        { name: "metadata", type: "object", required: true, description: "Metadata object with title, keywords, category fields." },
      ],
    },
    {
      name: "checkStatus",
      description: "Check the submission status counts (pending, approved, rejected).",
      params: [],
    },
    {
      name: "setReleaseType",
      description: "Set the release type for an asset.",
      params: [
        { name: "releaseType", type: "string", required: true, description: "Release type value to select." },
      ],
    },
  ],
};

async function navigateToUpload(page: Page): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log("[ADOBE_STOCK] Navigating to upload page.");

    const uploadLink = page.locator("a[href*='upload'], a:has-text('Upload')").first();
    await uploadLink.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    return { success: true, url: page.url() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function submitMetadata(page: Page, metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log("[ADOBE_STOCK] Submitting metadata.");

    const titleField = page.locator("input[name='title'], textarea[name='title']").first();
    if (metadata.title) {
      await titleField.fill(String(metadata.title));
    }

    const keywordsField = page.locator("input[name='keywords'], textarea[name='keywords']").first();
    if (metadata.keywords) {
      await keywordsField.fill(String(metadata.keywords));
    }

    const categoryField = page.locator("select[name='category']").first();
    if (metadata.category) {
      await categoryField.selectOption({ value: String(metadata.category) });
    }

    const submitButton = page.locator("button[type='submit'], button:has-text('Submit'), button:has-text('Save')").first();
    await submitButton.click();

    console.log("[ADOBE_STOCK] Metadata submitted.");
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function checkSubmissionStatus(page: Page): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log("[ADOBE_STOCK] Checking submission status.");

    const pendingCount = await page.locator("[data-testid='pending'], .status-pending").count();
    const approvedCount = await page.locator("[data-testid='approved'], .status-approved").count();
    const rejectedCount = await page.locator("[data-testid='rejected'], .status-rejected").count();

    return {
      success: true,
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function setReleaseType(page: Page, releaseType: string): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log(`[ADOBE_STOCK] Setting release type to ${releaseType}.`);

    const releaseSelect = page.locator("select[name='releaseType'], select[name='property_release']").first();
    await releaseSelect.selectOption({ value: releaseType });

    return { success: true, releaseType };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export function createAdobeStockSkill(): Skill {
  let ctx: SkillContext | undefined;

  return {
    manifest,

    async setup(context: SkillContext): Promise<void> {
      ctx = context;
      console.log(`[ADOBE_STOCK_SKILL] Setup for page: ${context.page.url()}`);
    },

    async execute(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
      const page = (ctx?.page ?? params.page) as Page | undefined;
      if (!page) {
        return { success: false, error: "No page provided in params." };
      }

      switch (action) {
        case "navigateToUpload":
          return navigateToUpload(page);
        case "submitMetadata":
          return submitMetadata(page, params.metadata as Record<string, unknown> ?? {});
        case "checkStatus":
          return checkSubmissionStatus(page);
        case "setReleaseType":
          return setReleaseType(page, params.releaseType as string);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    },

    async teardown(_context: SkillContext): Promise<void> {
      ctx = undefined;
      console.log("[ADOBE_STOCK_SKILL] Teardown.");
    },

    async healthCheck(_context: SkillContext): Promise<{ healthy: boolean; details?: string }> {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return { healthy: false, details: "OPENROUTER_API_KEY is not set." };
      }
      return { healthy: true };
    },
  };
}

export const adobeStockSkill = createAdobeStockSkill();

export default adobeStockSkill;
