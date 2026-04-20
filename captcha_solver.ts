import type { Page } from "playwright";
import type { Telemetry } from "./telemetry";

export type CaptchaProvider = "2captcha" | "anticaptcha" | "capsolver";
export type CaptchaKind = "recaptcha" | "hcaptcha" | "turnstile";

export interface CaptchaSolveResult {
  token: string;
  taskId: string;
  raw: unknown;
  cost?: number;
  ip?: string;
  createTime?: number;
  endTime?: number;
  solveCount?: number;
}

export interface CaptchaSolverOptions {
  provider?: CaptchaProvider;
  apiKey?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  telemetry?: Telemetry;
}

interface CaptchaTaskDetails {
  kind: CaptchaKind;
  siteKey: string;
  url: string;
  turnstile?: {
    action?: string;
    cData?: string;
    pageData?: string;
  };
}

interface CaptchaProviderDefinition {
  name: CaptchaProvider;
  createTaskUrl: string;
  getTaskResultUrl: string;
  supportedKinds: readonly CaptchaKind[];
  buildTask: (details: CaptchaTaskDetails) => Record<string, unknown>;
}

interface ProviderTaskResult {
  status: "processing" | "ready" | "failed";
  token?: string;
  raw: unknown;
  error?: string;
  cost?: number;
  ip?: string;
  createTime?: number;
  endTime?: number;
  solveCount?: number;
}

function parseProvider(value: string | undefined): CaptchaProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "anticaptcha" || normalized === "anti-captcha") {
    return "anticaptcha";
  }
  if (normalized === "capsolver") {
    return "capsolver";
  }
  return "2captcha";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getTokenFromSolution(solution: Record<string, unknown> | null | undefined): string | undefined {
  if (!solution) {
    return undefined;
  }

  for (const key of ["gRecaptchaResponse", "token", "text"]) {
    const value = solution[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

const PROVIDERS: Record<CaptchaProvider, CaptchaProviderDefinition> = {
  "2captcha": {
    name: "2captcha",
    createTaskUrl: "https://api.2captcha.com/createTask",
    getTaskResultUrl: "https://api.2captcha.com/getTaskResult",
    supportedKinds: ["recaptcha", "hcaptcha", "turnstile"],
    buildTask: (details) => {
      if (details.kind === "recaptcha") {
        return {
          type: "RecaptchaV2TaskProxyless",
          websiteURL: details.url,
          websiteKey: details.siteKey,
        };
      }

      if (details.kind === "hcaptcha") {
        return {
          type: "HCaptchaTaskProxyless",
          websiteURL: details.url,
          websiteKey: details.siteKey,
        };
      }

      return {
        type: "TurnstileTaskProxyless",
        websiteURL: details.url,
        websiteKey: details.siteKey,
        ...(details.turnstile?.action ? { action: details.turnstile.action } : {}),
        ...(details.turnstile?.cData ? { data: details.turnstile.cData } : {}),
        ...(details.turnstile?.pageData ? { pagedata: details.turnstile.pageData } : {}),
      };
    },
  },
  anticaptcha: {
    name: "anticaptcha",
    createTaskUrl: "https://api.anti-captcha.com/createTask",
    getTaskResultUrl: "https://api.anti-captcha.com/getTaskResult",
    supportedKinds: ["recaptcha", "turnstile"],
    buildTask: (details) => {
      if (details.kind === "recaptcha") {
        return {
          type: "RecaptchaV2TaskProxyless",
          websiteURL: details.url,
          websiteKey: details.siteKey,
        };
      }

      return {
        type: "TurnstileTaskProxyless",
        websiteURL: details.url,
        websiteKey: details.siteKey,
        ...(details.turnstile?.action ? { action: details.turnstile.action } : {}),
        ...(details.turnstile?.cData ? { cData: details.turnstile.cData } : {}),
        ...(details.turnstile?.pageData ? { chlPageData: details.turnstile.pageData } : {}),
      };
    },
  },
  capsolver: {
    name: "capsolver",
    createTaskUrl: "https://api.capsolver.com/createTask",
    getTaskResultUrl: "https://api.capsolver.com/getTaskResult",
    supportedKinds: ["recaptcha", "turnstile"],
    buildTask: (details) => {
      if (details.kind === "recaptcha") {
        return {
          type: "ReCaptchaV2TaskProxyLess",
          websiteURL: details.url,
          websiteKey: details.siteKey,
        };
      }

      return {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL: details.url,
        websiteKey: details.siteKey,
        ...(details.turnstile?.action || details.turnstile?.cData
          ? {
            metadata: {
              ...(details.turnstile?.action ? { action: details.turnstile.action } : {}),
              ...(details.turnstile?.cData ? { cdata: details.turnstile.cData } : {}),
            },
          }
          : {}),
      };
    },
  },
};

function createSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function detectCaptcha(page: Page, selector?: string): Promise<CaptchaTaskDetails | null> {
  return page.evaluate(({ selector: scopedSelector }) => {
    const root = scopedSelector
      ? document.querySelector(scopedSelector)
      : document;

    if (!root) {
      return null;
    }

    const asParent = root instanceof Element ? root : document.documentElement;
    const query = (value: string): Element | null => {
      if (root instanceof Element && root.matches(value)) {
        return root;
      }
      return asParent?.querySelector(value) ?? null;
    };

    const extractFromFrame = (needle: string): { siteKey: string | null; frame: HTMLIFrameElement | null } => {
      const frame = query(`iframe[src*="${needle}"]`) as HTMLIFrameElement | null;
      if (!frame) {
        return { siteKey: null, frame: null };
      }

      let siteKey: string | null = null;
      try {
        const frameUrl = new URL(frame.src, window.location.href);
        siteKey = frameUrl.searchParams.get("k")
          ?? frameUrl.searchParams.get("sitekey")
          ?? frame.getAttribute("data-sitekey");
      } catch {
        siteKey = frame.getAttribute("data-sitekey");
      }

      return { siteKey, frame };
    };

    const recaptchaElement = query(".g-recaptcha, [data-sitekey][data-callback], [data-sitekey][data-theme]");
    if (recaptchaElement) {
      return {
        kind: "recaptcha",
        siteKey: recaptchaElement.getAttribute("data-sitekey") ?? "",
        url: window.location.href,
      };
    }

    const recaptchaFrame = extractFromFrame("recaptcha");
    if (recaptchaFrame.siteKey) {
      return {
        kind: "recaptcha",
        siteKey: recaptchaFrame.siteKey,
        url: window.location.href,
      };
    }

    const hcaptchaElement = query(".h-captcha, [data-sitekey][data-size='invisible']");
    if (hcaptchaElement && hcaptchaElement.classList.contains("h-captcha")) {
      return {
        kind: "hcaptcha",
        siteKey: hcaptchaElement.getAttribute("data-sitekey") ?? "",
        url: window.location.href,
      };
    }

    const hcaptchaFrame = extractFromFrame("hcaptcha");
    if (hcaptchaFrame.siteKey) {
      return {
        kind: "hcaptcha",
        siteKey: hcaptchaFrame.siteKey,
        url: window.location.href,
      };
    }

    const turnstileElement = query(".cf-turnstile, [data-sitekey][data-cdata], [data-sitekey][data-action]");
    if (turnstileElement) {
      return {
        kind: "turnstile",
        siteKey: turnstileElement.getAttribute("data-sitekey") ?? "",
        url: window.location.href,
        turnstile: {
          action: turnstileElement.getAttribute("data-action") ?? undefined,
          cData: turnstileElement.getAttribute("data-cdata") ?? undefined,
          pageData: turnstileElement.getAttribute("data-pagedata") ?? undefined,
        },
      };
    }

    const turnstileFrame = extractFromFrame("turnstile");
    if (turnstileFrame.siteKey) {
      return {
        kind: "turnstile",
        siteKey: turnstileFrame.siteKey,
        url: window.location.href,
      };
    }

    return null;
  }, { selector });
}

async function injectCaptchaToken(page: Page, kind: CaptchaKind, token: string): Promise<boolean> {
  return page.evaluate(({ captchaKind, captchaToken }) => {
    const fieldNames = captchaKind === "recaptcha"
      ? ["g-recaptcha-response"]
      : captchaKind === "hcaptcha"
        ? ["h-captcha-response"]
        : ["cf-turnstile-response"];

    let injected = false;

    for (const fieldName of fieldNames) {
      const matchingFields = Array.from(document.querySelectorAll(`textarea[name="${fieldName}"], input[name="${fieldName}"]`));
      for (const field of matchingFields) {
        const input = field as HTMLInputElement | HTMLTextAreaElement;
        input.value = captchaToken;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        injected = true;
      }
    }

    return injected;
  }, {
    captchaKind: kind,
    captchaToken: token,
  });
}

export class CaptchaSolver {
  private readonly providerDefinition: CaptchaProviderDefinition;

  private readonly apiKey: string;

  private readonly timeoutMs: number;

  private readonly pollIntervalMs: number;

  private readonly fetchImpl: typeof fetch;

  private readonly sleep: (ms: number) => Promise<void>;

  private readonly telemetry?: Telemetry;

  constructor(options: CaptchaSolverOptions = {}) {
    const env = options.env ?? process.env;
    const provider = options.provider ?? parseProvider(env.CAPTCHA_PROVIDER);
    const apiKey = options.apiKey ?? env.CAPTCHA_API_KEY;
    if (!apiKey) {
      throw new Error("CAPTCHA_API_KEY is required to use CaptchaSolver.");
    }

    this.providerDefinition = PROVIDERS[provider];
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? Number(env.CAPTCHA_TIMEOUT_MS ?? 120_000);
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? createSleep;
    this.telemetry = options.telemetry;
  }

  private ensureKindSupported(kind: CaptchaKind): void {
    if (!this.providerDefinition.supportedKinds.includes(kind)) {
      throw new Error(`[CAPTCHA_SOLVER] Provider ${this.providerDefinition.name} does not support ${kind}.`);
    }
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`[CAPTCHA_SOLVER] HTTP ${response.status} calling ${url}.`);
    }

    return await response.json() as Record<string, unknown>;
  }

  private async createTask(details: CaptchaTaskDetails): Promise<string> {
    const payload = await this.postJson(this.providerDefinition.createTaskUrl, {
      clientKey: this.apiKey,
      task: this.providerDefinition.buildTask(details),
    });

    if (toNumber(payload.errorId) && toNumber(payload.errorId) !== 0) {
      throw new Error(
        `[CAPTCHA_SOLVER] ${this.providerDefinition.name} createTask failed: ${String(payload.errorCode ?? payload.errorDescription ?? "Unknown error")}`,
      );
    }

    const taskId = payload.taskId;
    if (taskId === undefined || taskId === null || String(taskId).trim() === "") {
      throw new Error(`[CAPTCHA_SOLVER] ${this.providerDefinition.name} createTask did not return a task id.`);
    }

    return String(taskId);
  }

  private async pollTask(taskId: string): Promise<ProviderTaskResult> {
    const payload = await this.postJson(this.providerDefinition.getTaskResultUrl, {
      clientKey: this.apiKey,
      taskId,
    });

    if (toNumber(payload.errorId) && toNumber(payload.errorId) !== 0) {
      return {
        status: "failed",
        raw: payload,
        error: String(payload.errorCode ?? payload.errorDescription ?? "Unknown error"),
      };
    }

    const status = String(payload.status ?? "");
    if (status === "processing") {
      return {
        status: "processing",
        raw: payload,
      };
    }

    const token = getTokenFromSolution(payload.solution as Record<string, unknown> | undefined);
    if (!token) {
      return {
        status: "failed",
        raw: payload,
        error: "Solved task did not include a usable token.",
      };
    }

    return {
      status: "ready",
      token,
      raw: payload,
      cost: toNumber(payload.cost),
      ip: typeof payload.ip === "string" ? payload.ip : undefined,
      createTime: toNumber(payload.createTime),
      endTime: toNumber(payload.endTime),
      solveCount: toNumber(payload.solveCount),
    };
  }

  private async solve(details: CaptchaTaskDetails): Promise<CaptchaSolveResult> {
    this.ensureKindSupported(details.kind);
    const startedAt = Date.now();

    const taskId = await this.createTask(details);
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() <= deadline) {
      const result = await this.pollTask(taskId);
      if (result.status === "ready") {
        this.telemetry?.record("captcha.solve", "success", Date.now() - startedAt, {
          provider: this.providerDefinition.name,
          kind: details.kind,
          taskId,
          tokenReceived: true,
        });
        return {
          token: result.token ?? "",
          taskId,
          raw: result.raw,
          cost: result.cost,
          ip: result.ip,
          createTime: result.createTime,
          endTime: result.endTime,
          solveCount: result.solveCount,
        };
      }

      if (result.status === "failed") {
        this.telemetry?.record("captcha.solve", "error", Date.now() - startedAt, {
          provider: this.providerDefinition.name,
          kind: details.kind,
          taskId,
          error: result.error,
        });
        throw new Error(`[CAPTCHA_SOLVER] ${result.error ?? "Task failed."}`);
      }

      await this.sleep(this.pollIntervalMs);
    }

    this.telemetry?.record("captcha.solve", "error", Date.now() - startedAt, {
      provider: this.providerDefinition.name,
      kind: details.kind,
      taskId,
      error: "Timed out waiting for solve result.",
    });
    throw new Error(`[CAPTCHA_SOLVER] Timed out waiting for ${details.kind} solve result.`);
  }

  solveReCaptcha(siteKey: string, url: string): Promise<CaptchaSolveResult> {
    return this.solve({
      kind: "recaptcha",
      siteKey,
      url,
    });
  }

  solveHCaptcha(siteKey: string, url: string): Promise<CaptchaSolveResult> {
    return this.solve({
      kind: "hcaptcha",
      siteKey,
      url,
    });
  }

  solveTurnstile(siteKey: string, url: string): Promise<CaptchaSolveResult> {
    return this.solve({
      kind: "turnstile",
      siteKey,
      url,
    });
  }

  async waitForCaptcha(page: Page, selector?: string, timeoutMs = this.timeoutMs): Promise<CaptchaSolveResult | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const detected = await detectCaptcha(page, selector);
      if (detected?.siteKey) {
        const result = await this.solve(detected);
        await injectCaptchaToken(page, detected.kind, result.token);
        return result;
      }

      await this.sleep(Math.min(this.pollIntervalMs || 250, 1_000));
    }

    return null;
  }
}
