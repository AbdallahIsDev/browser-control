import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright";

import { CaptchaSolver } from "./captcha_solver";

test("CaptchaSolver uses 2Captcha createTask/getTaskResult flow for reCAPTCHA", async () => {
  const requests: Array<{ url: string; body: string }> = [];

  const solver = new CaptchaSolver({
    provider: "2captcha",
    apiKey: "api-key-123",
    timeoutMs: 1_000,
    pollIntervalMs: 0,
    sleep: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
      });

      if (requests.length === 1) {
        return new Response(JSON.stringify({
          errorId: 0,
          taskId: 12345,
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        errorId: 0,
        status: "ready",
        solution: {
          gRecaptchaResponse: "token-123",
        },
        cost: "0.002",
        solveCount: 1,
      }), { status: 200 });
    },
  });

  const result = await solver.solveReCaptcha("site-key-1", "https://example.com/login");

  assert.equal(result.token, "token-123");
  assert.equal(result.taskId, "12345");
  assert.equal(requests[0]?.url, "https://api.2captcha.com/createTask");
  assert.match(requests[0]?.body ?? "", /RecaptchaV2TaskProxyless/);
  assert.match(requests[0]?.body ?? "", /site-key-1/);
  assert.equal(requests[1]?.url, "https://api.2captcha.com/getTaskResult");
});

test("CaptchaSolver builds a CapSolver turnstile task and returns the normalized token", async () => {
  const requests: Array<{ url: string; body: string }> = [];

  const solver = new CaptchaSolver({
    provider: "capsolver",
    apiKey: "capsolver-key",
    timeoutMs: 1_000,
    pollIntervalMs: 0,
    sleep: async () => undefined,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
      });

      if (requests.length === 1) {
        return new Response(JSON.stringify({
          errorId: 0,
          taskId: "task-7",
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        errorId: 0,
        status: "ready",
        solution: {
          token: "turnstile-token-7",
        },
      }), { status: 200 });
    },
  });

  const result = await solver.solveTurnstile("turnstile-key", "https://example.com/challenge");

  assert.equal(result.token, "turnstile-token-7");
  assert.equal(result.taskId, "task-7");
  assert.equal(requests[0]?.url, "https://api.capsolver.com/createTask");
  assert.match(requests[0]?.body ?? "", /AntiTurnstileTaskProxyLess/);
});

test("waitForCaptcha detects a captcha, solves it, and injects the token into the page", async () => {
  const evaluateCalls: unknown[] = [];
  let requestCount = 0;

  const page = {
    url: () => "https://example.com/login",
    evaluate: async (_fn: unknown, arg?: unknown) => {
      if (evaluateCalls.length === 0) {
        evaluateCalls.push("detect");
        return {
          kind: "recaptcha",
          siteKey: "page-site-key",
          url: "https://example.com/login",
        };
      }

      evaluateCalls.push(arg);
      return true;
    },
  } as unknown as Page;

  const solver = new CaptchaSolver({
    provider: "2captcha",
    apiKey: "api-key-123",
    timeoutMs: 1_000,
    pollIntervalMs: 0,
    sleep: async () => undefined,
    fetchImpl: async (_input, _init) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({
          errorId: 0,
          taskId: 999,
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        errorId: 0,
        status: "ready",
        solution: {
          gRecaptchaResponse: "page-token-999",
        },
      }), { status: 200 });
    },
  });

  const result = await solver.waitForCaptcha(page, undefined, 1_000);

  assert.equal(result?.token, "page-token-999");
  assert.deepEqual(evaluateCalls[1], {
    captchaKind: "recaptcha",
    captchaToken: "page-token-999",
  });
});

test("solveHCaptcha throws for providers that do not advertise hcaptcha support", async () => {
  const solver = new CaptchaSolver({
    provider: "capsolver",
    apiKey: "capsolver-key",
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });

  await assert.rejects(
    () => solver.solveHCaptcha("site-key", "https://example.com"),
    /does not support hcaptcha/i,
  );
});
