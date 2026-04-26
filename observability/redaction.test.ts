/**
 * Redaction Tests — Verify secret filtering across all input types.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  redactUrl,
  redactString,
  redactHeaders,
  redactConsoleEntry,
  redactNetworkEntry,
  redactObject,
} from "./redaction";
import type { ConsoleEntry, NetworkEntry } from "./types";

describe("redactUrl", () => {
  it("redacts sensitive query params", () => {
    const url = "https://example.com/api?token=secret123&api_key=abc&normal=value";
    const result = redactUrl(url);
    assert(result.includes("REDACTED"));
    assert(!result.includes("secret123"));
    assert(!result.includes("abc"));
    assert(result.includes("normal=value"));
  });

  it("presents non-sensitive params", () => {
    const url = "https://example.com/api?page=1&limit=10";
    const result = redactUrl(url);
    assert.strictEqual(result, url);
  });

  it("handles invalid URLs gracefully", () => {
    const result = redactUrl("not-a-url");
    assert(typeof result === "string");
  });

  it("redacts URL username and password credentials", () => {
    const result = redactUrl("https://alice:supersecret@example.com/path?ok=1");
    assert(!result.includes("alice"));
    assert(!result.includes("supersecret"));
    assert(result.includes("REDACTED"));
  });
});

describe("redactString", () => {
  it("redacts API keys", () => {
    const input = "Authorization: api_key=super_secret_key_12345";
    const result = redactString(input);
    assert(result.includes("[REDACTED]"));
    assert(!result.includes("super_secret_key_12345"));
  });

  it("redacts Bearer tokens", () => {
    const input = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const result = redactString(input);
    assert(result.includes("[REDACTED]"));
    assert(!result.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  });

  it("redacts full JWT bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_secret";
    const result = redactString(`Authorization: Bearer ${jwt}`);

    assert.equal(result, "Authorization: [REDACTED]");
    assert(!result.includes("eyJ"));
    assert(!result.includes("signature_secret"));
  });

  it("redacts cookies", () => {
    const input = "Cookie: session_id=abc123; auth_token=xyz789";
    const result = redactString(input);
    assert(result.includes("[REDACTED]"));
  });

  it("redacts full Cookie headers", () => {
    const input = "Cookie: session_id=abc123; auth_token=xyz789; theme=dark";
    const result = redactString(input);

    assert.equal(result, "Cookie: [REDACTED]");
    assert(!result.includes("abc123"));
    assert(!result.includes("xyz789"));
    assert(!result.includes("theme=dark"));
  });

  it("redacts Set-Cookie headers in arbitrary strings", () => {
    const input = "Set-Cookie: sid=supersecretsession; HttpOnly";
    const result = redactString(input);
    assert(result.includes("[REDACTED]"));
    assert(!result.includes("supersecretsession"));
  });

  it("leaves harmless text intact", () => {
    const input = "Hello world, this is a normal message";
    const result = redactString(input);
    assert.strictEqual(result, input);
  });

  it("redacts token query params embedded in error strings", () => {
    const input = "Playwright failed connecting to wss://production.browserless.io?token=supersecrettoken1234567890&session=abc";
    const result = redactString(input);
    assert(result.includes("REDACTED"));
    assert(!result.includes("supersecrettoken1234567890"));
    assert(result.includes("session=abc"));
  });

  it("does not recurse on invalid URL-like strings with trailing punctuation", () => {
    const input = "Tried: http://127.0.0.1:9222, http://localhost:9222";
    const result = redactString(input);
    assert(result.includes("http://127.0.0.1:9222"));
    assert(result.includes("http://localhost:9222"));
  });

  it("redacts Browser Control fake test secret values wherever they appear", () => {
    const input = "C:/tmp/bc_secret_test_token_12345/missing.txt";
    const result = redactString(input);
    assert.strictEqual(result, "C:/tmp/[REDACTED]/missing.txt");
  });
});

describe("redactHeaders", () => {
  it("redacts authorization headers", () => {
    const headers = {
      Authorization: "Bearer secret_token",
      "Content-Type": "application/json",
    };
    const result = redactHeaders(headers);
    assert.strictEqual(result.Authorization, "[REDACTED]");
    assert.strictEqual(result["Content-Type"], "application/json");
  });

  it("redacts cookie headers", () => {
    const headers = {
      Cookie: "session=abc123",
      Accept: "application/json",
    };
    const result = redactHeaders(headers);
    assert.strictEqual(result.Cookie, "[REDACTED]");
    assert.strictEqual(result.Accept, "application/json");
  });
});

describe("redactConsoleEntry", () => {
  it("redacts secrets in console messages", () => {
    const entry: ConsoleEntry = {
      level: "log",
      message: "api_key=super_secret_key_12345",
      timestamp: "2024-01-01T00:00:00Z",
    };
    const result = redactConsoleEntry(entry);
    assert(result.message.includes("[REDACTED]"));
    assert(!result.message.includes("super_secret_key_12345"));
    assert.strictEqual(result.level, "log");
  });

  it("redacts secrets in pageUrl", () => {
    const entry: ConsoleEntry = {
      level: "error",
      message: "failed",
      pageUrl: "https://example.test/app?token=page-secret&view=main",
      timestamp: "2024-01-01T00:00:00Z",
    };

    const result = redactConsoleEntry(entry);

    assert(result.pageUrl?.includes("REDACTED"));
    assert(!result.pageUrl?.includes("page-secret"));
    assert(result.pageUrl?.includes("view=main"));
  });
});

describe("redactNetworkEntry", () => {
  it("redacts secrets in network URLs", () => {
    const entry: NetworkEntry = {
      url: "https://example.com/api?token=secret123",
      method: "GET",
      timestamp: "2024-01-01T00:00:00Z",
    };
    const result = redactNetworkEntry(entry);
    // URL encoding turns [REDACTED] into %5BREDACTED%5D
    assert(result.url.includes("REDACTED"));
    assert.strictEqual(result.redacted, true);
  });

  it("redacts secrets in network pageUrl", () => {
    const entry: NetworkEntry = {
      url: "https://api.example.test/data",
      pageUrl: "https://example.test/app?access_token=page-secret&view=main",
      method: "GET",
      timestamp: "2024-01-01T00:00:00Z",
    };

    const result = redactNetworkEntry(entry);

    assert(result.pageUrl?.includes("REDACTED"));
    assert(!result.pageUrl?.includes("page-secret"));
    assert(result.pageUrl?.includes("view=main"));
  });
});

describe("redactObject", () => {
  it("redacts nested secrets", () => {
    const obj = {
      user: "alice",
      password: "supersecret",
      config: {
        api_key: "key123",
        url: "https://example.com",
      },
    };
    const result = redactObject(obj) as Record<string, unknown>;
    assert.strictEqual(result.password, "[REDACTED]");
    assert.strictEqual((result.config as Record<string, unknown>).api_key, "[REDACTED]");
    assert.strictEqual(result.user, "alice");
  });

  it("handles arrays", () => {
    const arr = ["api_key=super_secret_key_12345", "normal text"];
    const result = redactObject(arr) as string[];
    assert(result[0].includes("[REDACTED]"));
    assert.strictEqual(result[1], "normal text");
  });

  it("redacts secret-like object keys by suffix", () => {
    const result = redactObject({
      browserless_token: "supersecrettoken1234567890",
      nested: { refresh_token: "refreshsecrettoken1234567890" },
    }) as Record<string, unknown>;

    assert.strictEqual(result.browserless_token, "[REDACTED]");
    assert.strictEqual((result.nested as Record<string, unknown>).refresh_token, "[REDACTED]");
  });

  it("redacts camelCase secret-like object keys", () => {
    const result = redactObject({
      browserlessApiKey: "browserless-key-value",
      openrouterApiKey: "openrouter-key-value",
      brokerAuthKey: "broker-key-value",
      privateKey: "private-key-value",
    }) as Record<string, unknown>;

    assert.strictEqual(result.browserlessApiKey, "[REDACTED]");
    assert.strictEqual(result.openrouterApiKey, "[REDACTED]");
    assert.strictEqual(result.brokerAuthKey, "[REDACTED]");
    assert.strictEqual(result.privateKey, "[REDACTED]");
  });

  it("preserves non-plain log data values", () => {
    const when = new Date("2024-01-01T00:00:00.000Z");
    const result = redactObject({ when }) as Record<string, unknown>;

    assert.strictEqual(result.when, when);
  });

  it("redacts URL objects before JSON serialization", () => {
    const result = redactObject({
      endpoint: new URL("wss://user:pass@example.test/cdp?token=secret-token-value&session=ok"),
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(result);

    assert(serialized.includes("REDACTED"));
    assert(!serialized.includes("user"));
    assert(!serialized.includes("pass"));
    assert(!serialized.includes("secret-token-value"));
    assert(serialized.includes("session=ok"));
  });
});
