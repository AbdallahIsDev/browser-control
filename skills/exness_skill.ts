import type { Page } from "playwright";
import type { Skill, SkillContext, SkillManifest } from "../skill";

const manifest: SkillManifest = {
  name: "exness",
  version: "1.0.0",
  description: "Automates Exness trading platform: login, navigate instruments, check balances.",
  author: "browser-control",
  requiredEnv: ["OPENROUTER_API_KEY"],
  allowedDomains: ["exness.com", "my.exness.com"],
  actions: [
    {
      name: "login",
      description: "Log in to the Exness trading platform.",
      params: [
        { name: "email", type: "string", required: true, description: "Account email address." },
        { name: "password", type: "string", required: true, description: "Account password." },
      ],
    },
    {
      name: "getBalance",
      description: "Read the current account balance.",
      params: [],
    },
    {
      name: "navigateToInstruments",
      description: "Navigate to the instruments/trading page.",
      params: [],
    },
  ],
};

async function login(page: Page, email: string, password: string): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log("[EXNESS] Starting login flow.");

    const emailInput = page.locator("input[type='email'], input[name='email']").first();
    await emailInput.fill(email);

    const passwordInput = page.locator("input[type='password'], input[name='password']").first();
    await passwordInput.fill(password);

    const submitButton = page.locator("button[type='submit'], button:has-text('Sign in')").first();
    await submitButton.click();

    await page.waitForURL("**/dashboard**", { timeout: 15000 }).catch(() => {});
    console.log("[EXNESS] Login flow completed.");
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[EXNESS] Login failed: ${message}`);
    return { success: false, error: message };
  }
}

async function getBalance(page: Page): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log("[EXNESS] Reading account balance.");

    const balanceElement = page.locator("[data-testid='balance'], .account-balance, [class*='balance']").first();
    const balanceText = await balanceElement.textContent({ timeout: 5000 });
    const balance = parseFloat(balanceText?.replace(/[^0-9.-]/g, "") ?? "0");

    return { success: true, balance, currency: "USD" };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function navigateToInstruments(page: Page): Promise<Record<string, unknown>> {
  try {
    await page.bringToFront();
    console.log("[EXNESS] Navigating to instruments page.");

    const instrumentsLink = page.locator("a[href*='instruments'], a:has-text('Instruments'), nav a:has-text('Trading')").first();
    await instrumentsLink.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    return { success: true, url: page.url() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export function createExnessSkill(): Skill {
  let ctx: SkillContext | undefined;

  return {
    manifest,

    async setup(context: SkillContext): Promise<void> {
      ctx = context;
      console.log(`[EXNESS_SKILL] Setup for page: ${context.page.url()}`);
    },

    async execute(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
      const page = (ctx?.page ?? params.page) as Page | undefined;
      if (!page) {
        return { success: false, error: "No page provided in params." };
      }

      switch (action) {
        case "login":
          return login(page, params.email as string, params.password as string);
        case "getBalance":
          return getBalance(page);
        case "navigateToInstruments":
          return navigateToInstruments(page);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    },

    async teardown(_context: SkillContext): Promise<void> {
      ctx = undefined;
      console.log("[EXNESS_SKILL] Teardown.");
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

export const exnessSkill = createExnessSkill();

export default exnessSkill;
