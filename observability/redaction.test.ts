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

  it("redacts cookies", () => {
    const input = "Cookie: session_id=abc123; auth_token=xyz789";
    const result = redactString(input);
    assert(result.includes("[REDACTED]"));
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
});
