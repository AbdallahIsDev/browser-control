import { Stagehand, type Action, type Page as StagehandPage } from "@browserbasehq/stagehand";
import type { Page as PlaywrightPage } from "playwright";
import { z, type ZodTypeAny } from "zod";
import { resolveDebugEndpointUrl } from "./browser_core";

export type AutomationPage = PlaywrightPage | StagehandPage;

export interface StagehandConnection {
  stagehand: Stagehand;
  page: StagehandPage;
}

let activeStagehand: Stagehand | null = null;
let activeStagehandPage: StagehandPage | null = null;

export async function getCdpWebSocketUrl(
  port: number,
  options: {
    fetchImpl?: typeof fetch;
    resolveDebugUrl?: (port: number) => Promise<string>;
  } = {},
): Promise<string> {
  const baseUrl = await (options.resolveDebugUrl ?? resolveDebugEndpointUrl)(port);
  const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/json/version`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    throw new Error(`Failed to read the CDP browser endpoint for port ${port}.`);
  }

  const payload = z.object({ webSocketDebuggerUrl: z.string().min(1) }).parse(await response.json());
  return payload.webSocketDebuggerUrl;
}

/** Return the active Stagehand instance for selector self-healing. */
export function getActiveStagehand(): Stagehand | null {
  return activeStagehand;
}

/** Attach Stagehand to the existing Chrome debug session and active tab. */
export async function connectStagehand(port: number, urlPattern: string): Promise<StagehandConnection> {
  const cdpUrl = await getCdpWebSocketUrl(port);
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required to connect Stagehand through OpenRouter.");
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    keepAlive: true,
    selfHeal: true,
    verbose: 0,
    model: {
      modelName: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash-preview:free",
      apiKey: openRouterApiKey,
      baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://github.com/AbdallahIsDev/browser-automation-core",
        "X-Title": "Browser Automation Core",
      },
    },
    localBrowserLaunchOptions: {
      cdpUrl,
      connectTimeoutMs: 5000,
    },
  });

  await stagehand.init();
  const page = stagehand.context.pages().find((entry: StagehandPage) => entry.url().includes(urlPattern))
    ?? stagehand.context.pages()[0];

  if (!page) {
    throw new Error(`Stagehand connected, but no page matched "${urlPattern}".`);
  }

  activeStagehand = stagehand;
  activeStagehandPage = page;
  return { stagehand, page };
}

/** Disconnect the active Stagehand instance without closing Chrome. */
export async function disconnectStagehand(): Promise<void> {
  if (!activeStagehand) {
    return;
  }
  await activeStagehand.close();
  activeStagehand = null;
  activeStagehandPage = null;
}

/** Execute a natural-language action with Stagehand and log it. */
export async function act(_page: AutomationPage, instruction: string): Promise<void> {
  if (!activeStagehand || !activeStagehandPage) {
    throw new Error("Stagehand is not connected.");
  }
  console.log(`[STAGEHAND] act -> ${instruction}`);
  await activeStagehand.act(instruction, { page: activeStagehandPage });
}

/** Observe the current page state with Stagehand and log it. */
export async function observe(_page: AutomationPage, instruction?: string): Promise<Action[]> {
  if (!activeStagehand || !activeStagehandPage) {
    throw new Error("Stagehand is not connected.");
  }
  console.log(`[STAGEHAND] observe -> ${instruction ?? "page state"}`);
  if (instruction) {
    return activeStagehand.observe(instruction, { page: activeStagehandPage });
  }
  return activeStagehand.observe({ page: activeStagehandPage });
}

/** Extract structured data from the page with Stagehand and log it. */
export async function extract<TSchema extends ZodTypeAny>(
  _page: AutomationPage,
  schema: TSchema,
  instruction: string,
): Promise<z.infer<TSchema>> {
  if (!activeStagehand || !activeStagehandPage) {
    throw new Error("Stagehand is not connected.");
  }
  console.log(`[STAGEHAND] extract -> ${instruction}`);
  const extractWithPage = activeStagehand.extract as (
    value: string,
    schemaValue: TSchema,
    options: { page: AutomationPage },
  ) => Promise<z.infer<TSchema>>;
  return extractWithPage(instruction, schema, { page: activeStagehandPage });
}
