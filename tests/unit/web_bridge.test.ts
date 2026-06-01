import assert from "node:assert/strict";
import test from "node:test";

import { fetchBrokerJson } from "../../src/web/bridge";

test("fetchBrokerJson aborts broker requests after timeout", async (t) => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_input, init) => {
    receivedSignal = init?.signal as AbortSignal | undefined;
    return await new Promise<Response>((_resolve, reject) => {
      receivedSignal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    () =>
      fetchBrokerJson("/api/v1/tasks", {
        env: { ...process.env, BROKER_PORT: "1" },
        timeoutMs: 5,
      }),
    /Broker request timed out after 5ms/,
  );
  assert.ok(receivedSignal);
  assert.equal(receivedSignal.aborted, true);
});

test("fetchBrokerJson sends broker API version negotiation header", async (t) => {
  const originalFetch = globalThis.fetch;
  let receivedHeaders: HeadersInit | undefined;

  globalThis.fetch = (async (_input, init) => {
    receivedHeaders = init?.headers;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await fetchBrokerJson("/api/v1/tasks", {
    env: { ...process.env, BROKER_PORT: "1", BROKER_API_KEY: "test-key" },
  });

  assert.equal((receivedHeaders as Record<string, string>)["accept-version"], "1");
});
