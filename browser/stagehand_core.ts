import { Stagehand, type Action, type Page as StagehandPage } from "@browserbasehq/stagehand";
import type { Page as PlaywrightPage } from "playwright";
import { z, type ZodTypeAny } from "zod";
import { resolveDebugEndpointUrl } from "./core";
import { loadConfig, type BrowserControlConfig } from "../shared/config";
import { logger } from "../shared/logger";

const log = logger.withComponent("stagehand");

export type AutomationPage = PlaywrightPage | StagehandPage;

export interface StagehandConnection {
  stagehand: Stagehand;
  page: StagehandPage;
}

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

// ── Multi-session StagehandManager ──────────────────────────────────

export class StagehandManager {
  private readonly sessions = new Map<string, StagehandConnection>();

  async createSession(id: string, port: number, urlPattern: string, options: { config?: BrowserControlConfig } = {}): Promise<StagehandConnection> {
    if (this.sessions.has(id)) {
      throw new Error(`Session "${id}" already exists.`);
    }

    const cdpUrl = await getCdpWebSocketUrl(port);
    const appConfig = options.config ?? loadConfig({ validate: false });
    const openRouterApiKey = appConfig.openrouterApiKey;
    if (!openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is required to connect Stagehand through OpenRouter.");
    }

    const stagehand = new Stagehand({
      env: "LOCAL",
      keepAlive: true,
      selfHeal: true,
      verbose: 0,
      model: {
        modelName: appConfig.stagehandModel,
        apiKey: openRouterApiKey,
        baseURL: appConfig.openrouterBaseUrl,
        headers: {
          "HTTP-Referer": "https://github.com/AbdallahIsDev/browser-control",
          "X-Title": "Browser Control",
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
      await stagehand.close();
      throw new Error(`Stagehand connected, but no page matched "${urlPattern}".`);
    }

    const connection: StagehandConnection = { stagehand, page };
    this.sessions.set(id, connection);
    log.info(`Session "${id}" created.`);
    return connection;
  }

  getSession(id: string): StagehandConnection | undefined {
    return this.sessions.get(id);
  }

  async destroySession(id: string): Promise<void> {
    const connection = this.sessions.get(id);
    if (!connection) {
      return;
    }
    await connection.stagehand.close();
    this.sessions.delete(id);
    log.info(`Session "${id}" destroyed.`);
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  async closeAll(): Promise<void> {
    const ids = this.listSessions();
    await Promise.all(ids.map((id) => this.destroySession(id)));
    log.info(`All ${ids.length} session(s) closed.`);
  }

  /** Execute a natural-language action in a specific session. */
  async actInSession(sessionId: string, instruction: string): Promise<void> {
    const connection = this.sessions.get(sessionId);
    if (!connection) {
      throw new Error(`Session "${sessionId}" does not exist.`);
    }
    log.info(`act [${sessionId}] -> ${instruction}`);
    await connection.stagehand.act(instruction, { page: connection.page });
  }

  /** Observe the current page state in a specific session. */
  async observeInSession(sessionId: string, instruction?: string): Promise<Action[]> {
    const connection = this.sessions.get(sessionId);
    if (!connection) {
      throw new Error(`Session "${sessionId}" does not exist.`);
    }
    log.info(`observe [${sessionId}] -> ${instruction ?? "page state"}`);
    if (instruction) {
      return connection.stagehand.observe(instruction, { page: connection.page });
    }
    return connection.stagehand.observe({ page: connection.page });
  }

  /** Extract structured data from a session. */
  async extractFromSession<TSchema extends ZodTypeAny>(
    sessionId: string,
    schema: TSchema,
    instruction: string,
  ): Promise<z.infer<TSchema>> {
    const connection = this.sessions.get(sessionId);
    if (!connection) {
      throw new Error(`Session "${sessionId}" does not exist.`);
    }
    log.info(`extract [${sessionId}] -> ${instruction}`);
    const extractWithPage = connection.stagehand.extract as (
      value: string,
      schemaValue: TSchema,
      options: { page: StagehandPage },
    ) => Promise<z.infer<TSchema>>;
    return extractWithPage(instruction, schema, { page: connection.page });
  }
}

// ── Legacy singleton API (backward-compatible) ──────────────────────

let activeStagehand: Stagehand | null = null;
let activeStagehandPage: StagehandPage | null = null;

/** Return the active Stagehand instance for selector self-healing. */
export function getActiveStagehand(): Stagehand | null {
  return activeStagehand;
}

/** Attach Stagehand to the existing Chrome debug session and active tab. */
export async function connectStagehand(port: number, urlPattern: string, options: { config?: BrowserControlConfig } = {}): Promise<StagehandConnection> {
  const cdpUrl = await getCdpWebSocketUrl(port);
  const appConfig = options.config ?? loadConfig({ validate: false });
  const openRouterApiKey = appConfig.openrouterApiKey;
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required to connect Stagehand through OpenRouter.");
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    keepAlive: true,
    selfHeal: true,
    verbose: 0,
    model: {
      modelName: appConfig.stagehandModel,
      apiKey: openRouterApiKey,
      baseURL: appConfig.openrouterBaseUrl,
      headers: {
        "HTTP-Referer": "https://github.com/AbdallahIsDev/browser-control",
        "X-Title": "Browser Control",
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
  log.info(`act -> ${instruction}`);
  await activeStagehand.act(instruction, { page: activeStagehandPage });
}

/** Observe the current page state with Stagehand and log it. */
export async function observe(_page: AutomationPage, instruction?: string): Promise<Action[]> {
  if (!activeStagehand || !activeStagehandPage) {
    throw new Error("Stagehand is not connected.");
  }
  log.info(`observe -> ${instruction ?? "page state"}`);
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
  log.info(`extract -> ${instruction}`);
  const extractWithPage = activeStagehand.extract as (
    value: string,
    schemaValue: TSchema,
    options: { page: AutomationPage },
  ) => Promise<z.infer<TSchema>>;
  return extractWithPage(instruction, schema, { page: activeStagehandPage });
}
