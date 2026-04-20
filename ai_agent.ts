import type { Page } from "playwright";

import { smartClick, smartFill } from "./browser_core";
import { loadConfig, type BrowserControlConfig } from "./config";
import { logger } from "./logger";
import type { StagehandManager } from "./stagehand_core";
import type { Task, TaskContext, TaskResult } from "./task_engine";
import type { Telemetry } from "./telemetry";

const log = logger.withComponent("ai_agent");

export class GuardrailError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
  ) {
    super(message);
    this.name = "GuardrailError";
  }
}

export interface AIGuardrails {
  maxCostPerGoalUsd?: number;
  maxSteps?: number;
  requireConfirmation?: boolean;
  dryRun?: boolean;
  allowedActions?: string[];
  deniedSelectors?: string[];
}

export interface AgentPageDescription {
  url: string;
  title: string;
  buttons: string[];
  inputs: string[];
  links: string[];
  forms: number;
  textSnippets: string[];
  candidateSelectors: Array<{
    selector: string;
    text: string;
    type: string;
  }>;
}

interface AgentDecision {
  action: "click" | "fill" | "press" | "wait" | "locate" | "done";
  selector?: string;
  value?: string;
  key?: string;
  rationale: string;
}

interface AIAgentOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Cost per token in USD — overrides config/env default. */
  costPerToken?: number;
  fetchImpl?: typeof fetch;
  decide?: (prompt: string, description: AgentPageDescription, history: AgentDecision[]) => Promise<AgentDecision>;
  telemetry?: Telemetry;
  stagehandManager?: StagehandManager;
  guardrails?: AIGuardrails;
  /** Centralized config — used as fallback when explicit options are not provided. */
  config?: BrowserControlConfig;
}

interface GoalExecutionResult {
  success: boolean;
  steps: number;
  error?: string;
  decisions: AgentDecision[];
}

function parseDecision(content: string): AgentDecision {
  const parsed = JSON.parse(content) as AgentDecision;
  return parsed;
}

const DESTRUCTIVE_SELECTOR_PATTERNS = [
  /submit/i,
  /delete/i,
  /pay/i,
  /confirm/i,
  /order/i,
  /purchase/i,
  /buy/i,
  /checkout/i,
];

const DESTRUCTIVE_INPUT_PATTERNS = [
  /card/i,
  /cvv/i,
  /cvc/i,
  /credit/i,
  /payment/i,
  /account.?number/i,
  /routing.?number/i,
];

function isDestructiveAction(decision: AgentDecision): boolean {
  const selector = decision.selector ?? "";
  if (decision.action === "click") {
    return DESTRUCTIVE_SELECTOR_PATTERNS.some((pattern) => pattern.test(selector));
  }
  if (decision.action === "fill") {
    return DESTRUCTIVE_INPUT_PATTERNS.some((pattern) => pattern.test(selector));
  }
  return false;
}

function selectorMatchesPattern(selector: string, pattern: string): boolean {
  // Exact match
  if (selector === pattern) return true;
  // Regex match if pattern starts and ends with /
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const lastSlash = pattern.lastIndexOf("/");
    const flags = pattern.slice(lastSlash + 1);
    const regexBody = pattern.slice(1, lastSlash);
    try {
      const regex = new RegExp(regexBody, flags);
      return regex.test(selector);
    } catch {
      return false;
    }
  }
  // Substring match
  return selector.includes(pattern);
}

export class AIAgent {
  private readonly apiKey: string;

  private readonly model: string;

  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

  private readonly decideImpl?: AIAgentOptions["decide"];

  private readonly telemetry?: Telemetry;

  private readonly stagehandManager?: StagehandManager;

  private readonly guardrails: AIGuardrails;

  private readonly costPerToken: number;

  private readonly decisionLog: AgentDecision[] = [];

  private totalTokens = 0;

  private estimatedCostUsd = 0;

  constructor(options: AIAgentOptions = {}) {
    const appConfig = options.config ?? loadConfig({ validate: false });

    this.apiKey = options.apiKey ?? appConfig.openrouterApiKey ?? "";
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is required to use AIAgent.");
    }

    this.model = options.model ?? appConfig.openrouterModel;
    this.baseUrl = options.baseUrl ?? appConfig.openrouterBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.decideImpl = options.decide;
    this.telemetry = options.telemetry;
    this.stagehandManager = options.stagehandManager;
    this.guardrails = options.guardrails ?? {};
    this.costPerToken = options.costPerToken ?? appConfig.aiAgentCostPerToken;
  }

  getDecisionLog(): AgentDecision[] {
    return [...this.decisionLog];
  }

  getEstimatedCostUsd(): number {
    return this.estimatedCostUsd;
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  /** Execute a goal against a page or session. Accepts a Page directly or a session ID string. */
  async executeGoal(goal: string, pageOrSessionId: Page | string, maxSteps = 10): Promise<GoalExecutionResult> {
    const page = await this.resolvePage(pageOrSessionId);

    // Apply guardrails maxSteps (whichever is lower)
    let effectiveMaxSteps = maxSteps;
    if (this.guardrails.maxSteps !== undefined) {
      effectiveMaxSteps = Math.min(maxSteps, this.guardrails.maxSteps);
    }

    const startedAt = Date.now();
    for (let step = 1; step <= effectiveMaxSteps; step += 1) {
      // Check cost cap before each decision
      if (this.guardrails.maxCostPerGoalUsd !== undefined && this.estimatedCostUsd > this.guardrails.maxCostPerGoalUsd) {
        const message = `[GUARDRAIL] Cost limit exceeded: $${this.estimatedCostUsd.toFixed(4)} > $${this.guardrails.maxCostPerGoalUsd}`;
        this.telemetry?.record("ai.goal", "error", Date.now() - startedAt, {
          goal,
          steps: step,
          error: message,
        });
        throw new GuardrailError(message, "maxCostPerGoalUsd");
      }

      const description = await this.observeAndDescribe(page);
      const decision = await this.decide(goal, description);
      this.decisionLog.push(decision);
      log.info(`Step ${step}: ${decision.action} (${decision.rationale})`);
      this.telemetry?.record("ai.decision", "success", 0, {
        action: decision.action,
        selector: decision.selector,
      });

      if (decision.action === "done") {
        this.telemetry?.record("ai.goal", "success", Date.now() - startedAt, {
          goal,
          steps: step,
        });
        return {
          success: true,
          steps: step,
          decisions: this.getDecisionLog(),
        };
      }

      await this.executeDecision(page, decision);
    }

    this.telemetry?.record("ai.goal", "error", Date.now() - startedAt, {
      goal,
      steps: effectiveMaxSteps,
      error: `Goal not reached within ${effectiveMaxSteps} steps.`,
    });
    return {
      success: false,
      steps: effectiveMaxSteps,
      error: `Goal not reached within ${effectiveMaxSteps} steps.`,
      decisions: this.getDecisionLog(),
    };
  }

  async observeAndDescribe(page: Page): Promise<AgentPageDescription> {
    const [title, details] = await Promise.all([
      page.title(),
      page.evaluate(() => {
        const normalizeText = (value: string | null | undefined): string => (value ?? "").trim();

        const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
          .map((element) => normalizeText((element as HTMLElement).innerText))
          .filter(Boolean)
          .slice(0, 12);

        const inputs = Array.from(document.querySelectorAll("input, textarea"))
          .map((element) => {
            const input = element as HTMLInputElement | HTMLTextAreaElement;
            return normalizeText(input.placeholder || input.name || input.id);
          })
          .filter(Boolean)
          .slice(0, 12);

        const links = Array.from(document.querySelectorAll("a"))
          .map((element) => normalizeText((element as HTMLElement).innerText))
          .filter(Boolean)
          .slice(0, 12);

        const textSnippets = Array.from(document.querySelectorAll("h1, h2, h3, p, label"))
          .map((element) => normalizeText((element as HTMLElement).innerText))
          .filter(Boolean)
          .slice(0, 12);

        const candidateSelectors = Array.from(document.querySelectorAll("button, input, textarea, a, [role='button']"))
          .map((element) => {
            const htmlElement = element as HTMLElement;
            const id = htmlElement.id ? `#${htmlElement.id}` : null;
            const dataTest = htmlElement.getAttribute("data-test");
            const dataTestId = htmlElement.getAttribute("data-testid");
            const ariaLabel = htmlElement.getAttribute("aria-label");
            const selector = dataTest
              ? `[data-test="${dataTest}"]`
              : dataTestId
                ? `[data-testid="${dataTestId}"]`
                : ariaLabel
                  ? `[aria-label="${ariaLabel}"]`
                  : id
                    ? id
                    : htmlElement.tagName.toLowerCase();

            return {
              selector,
              text: normalizeText(htmlElement.innerText || htmlElement.textContent),
              type: htmlElement.tagName.toLowerCase(),
            };
          })
          .slice(0, 24);

        return {
          buttons,
          inputs,
          links,
          forms: document.querySelectorAll("form").length,
          textSnippets,
          candidateSelectors,
        };
      }),
    ]);

    return {
      url: page.url(),
      title,
      ...details,
    };
  }

  async findElement(pageOrSessionId: Page | string, description: string): Promise<string | null> {
    const page = await this.resolvePage(pageOrSessionId);
    const observation = await this.observeAndDescribe(page);
    const decision = await this.decide(
      `Find the best selector for ${description}. Return action=locate and selector.`,
      observation,
    );

    return decision.selector ?? null;
  }

  createGoalTask(id: string, name: string, goal: string, pageOrSessionId: Page | string, maxSteps = 10): Task {
    return {
      id,
      name,
      action: async (_context: TaskContext): Promise<TaskResult> => {
        const result = await this.executeGoal(goal, pageOrSessionId, maxSteps);
        if (!result.success) {
          return {
            success: false,
            error: result.error,
          };
        }

        return {
          success: true,
          data: result,
        };
      },
    };
  }

  private async decide(goal: string, description: AgentPageDescription): Promise<AgentDecision> {
    const prompt = [
      `Goal: ${goal}`,
      `URL: ${description.url}`,
      `Title: ${description.title}`,
      `Buttons: ${description.buttons.join(", ") || "none"}`,
      `Inputs: ${description.inputs.join(", ") || "none"}`,
      `Links: ${description.links.join(", ") || "none"}`,
      `Text: ${description.textSnippets.join(" | ") || "none"}`,
      `Candidate selectors: ${description.candidateSelectors.map((entry) => `${entry.selector} -> ${entry.text || entry.type}`).join("; ") || "none"}`,
      `Previous decisions: ${JSON.stringify(this.decisionLog)}`,
      "Return JSON with keys: action, selector, value, key, rationale.",
    ].join("\n");

    if (this.decideImpl) {
      return this.decideImpl(prompt, description, this.getDecisionLog());
    }

    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "You are a browser automation planner. Return compact JSON only.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`[AI_AGENT] OpenRouter request failed with HTTP ${response.status}.`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
        usage?: {
          total_tokens?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("[AI_AGENT] OpenRouter response did not include a decision.");
      }

      // Track token usage
      if (payload.usage?.total_tokens) {
        this.totalTokens += payload.usage.total_tokens;
      } else {
        // Estimate tokens from prompt + response length
        const estimatedTokens = Math.ceil((prompt.length + content.length) / 4);
        this.totalTokens += estimatedTokens;
      }
      this.estimatedCostUsd = this.totalTokens * this.costPerToken;

      // Try to parse the decision with retry on failure
      try {
        return parseDecision(content);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log.warn(`JSON parse failed (attempt ${attempt}/${maxRetries}): ${lastError.message}`);
        if (attempt === maxRetries) {
          break;
        }
        // Continue to next iteration for a fresh LLM call
      }
    }

    throw new Error(`[AI_AGENT] Failed to parse decision after ${maxRetries} attempts. Last error: ${lastError?.message}`);
  }

  private async resolvePage(pageOrSessionId: Page | string): Promise<Page> {
    if (typeof pageOrSessionId !== "string") {
      return pageOrSessionId;
    }

    if (!this.stagehandManager) {
      throw new Error(`Cannot resolve session ID "${pageOrSessionId}": no StagehandManager configured.`);
    }

    const connection = this.stagehandManager.getSession(pageOrSessionId);
    if (!connection) {
      throw new Error(`Session "${pageOrSessionId}" does not exist in StagehandManager.`);
    }

    return connection.page as unknown as Page;
  }

  private async executeDecision(page: Page, decision: AgentDecision): Promise<void> {
    // Dry run guardrail
    if (this.guardrails.dryRun) {
      const selector = decision.selector ?? "N/A";
      log.info(`Dry run: would execute ${decision.action} on ${selector}`);
      return;
    }

    // Allowed actions guardrail
    if (this.guardrails.allowedActions && !this.guardrails.allowedActions.includes(decision.action)) {
      throw new GuardrailError(
        `[GUARDRAIL] Action "${decision.action}" is not in allowedActions: ${this.guardrails.allowedActions.join(", ")}`,
        "allowedActions",
      );
    }

    // Denied selectors guardrail
    if (this.guardrails.deniedSelectors && decision.selector) {
      for (const pattern of this.guardrails.deniedSelectors) {
        if (selectorMatchesPattern(decision.selector, pattern)) {
          throw new GuardrailError(
            `[GUARDRAIL] Selector "${decision.selector}" matches denied pattern "${pattern}"`,
            "deniedSelectors",
          );
        }
      }
    }

    // Require confirmation for destructive actions
    if (this.guardrails.requireConfirmation && isDestructiveAction(decision)) {
      throw new GuardrailError(
        `[GUARDRAIL] Confirmation required for destructive action: ${decision.action} on "${decision.selector}"`,
        "requireConfirmation",
      );
    }

    switch (decision.action) {
      case "click":
        if (!decision.selector) {
          throw new Error("[AI_AGENT] click decision requires a selector.");
        }
        await smartClick(page, decision.selector);
        return;
      case "fill":
        if (!decision.selector) {
          throw new Error("[AI_AGENT] fill decision requires a selector.");
        }
        await smartFill(page, decision.selector, decision.value ?? "");
        return;
      case "press":
        await page.keyboard.press(decision.key ?? "Enter");
        return;
      case "wait":
      case "locate":
        return;
      case "done":
        return;
      default:
        throw new Error(`[AI_AGENT] Unsupported action "${String(decision.action)}".`);
    }
  }
}
