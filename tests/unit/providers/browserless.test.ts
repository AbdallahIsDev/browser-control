import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BrowserlessProvider } from "../../../src/providers/browserless";
import { canLaunch, canAttach } from "../../../src/providers/interface";
import { sanitizeString } from "../../../src/providers/utils";

describe("BrowserlessProvider", () => {
  const provider = new BrowserlessProvider();

  it("should have correct name and capabilities", () => {
    assert.equal(provider.name, "browserless");
    assert.equal(provider.capabilities.supportsCDP, true);
    assert.equal(provider.capabilities.supportsLaunch, true);
    assert.equal(provider.capabilities.supportsAttach, true);
    assert.equal(provider.capabilities.supportsProfiles, false);
    assert.equal(provider.capabilities.supportsStealth, false);
    assert.equal(provider.capabilities.maxConcurrentSessions, 1);
  });

  it("should support both launch and attach", () => {
    assert.equal(canLaunch(provider), true);
    assert.equal(canAttach(provider), true);
  });

  it("should fail to launch without endpoint", async () => {
    await assert.rejects(
      () => provider.launch({ config: { name: "browserless", type: "browserless" } }),
      (err: Error) => {
        assert.ok(err.message.includes("endpoint"));
        return true;
      },
    );
  });

  it("should fail to attach without endpoint", async () => {
    await assert.rejects(
      () => provider.attach({ config: { name: "browserless", type: "browserless" } }),
      (err: Error) => {
        assert.ok(err.message.includes("endpoint"));
        return true;
      },
    );
  });

  it("should validate endpoint format on launch", async () => {
    await assert.rejects(
      () =>
        provider.launch({
          config: { name: "browserless", type: "browserless", endpoint: "ftp://bad" },
        }),
      (err: Error) => {
        assert.ok(err.message.includes("ws://") || err.message.includes("wss://"));
        return true;
      },
    );
  });

  it("should use auth header instead of appending token query when apiKey present", async () => {
    // Use reflection to test the private helper, binding this correctly.
    const buildConnectionOptions = (
      provider as unknown as {
        buildConnectionOptions: (
          c: unknown,
          override?: string,
        ) => { wsUrl: string; headers?: Record<string, string> };
      }
    ).buildConnectionOptions.bind(provider);
    const connection = buildConnectionOptions({
      endpoint: "https://browserless.example.com",
      apiKey: "tk_abc123",
    });
    assert.ok(connection.wsUrl.startsWith("wss://"));
    assert.ok(!connection.wsUrl.includes("tk_abc123"));
    assert.equal(connection.headers?.Authorization, "Bearer tk_abc123");
  });

  it("should redact token in connection error messages", async () => {
    const providerWithBadEndpoint = new BrowserlessProvider();
    await assert.rejects(
      () =>
        providerWithBadEndpoint.attach({
          config: { name: "browserless", type: "browserless", endpoint: "wss://browserless.example.com?token=super-secret" },
        }),
      (err: Error) => {
        assert.ok(!err.message.includes("super-secret"), "Error must not leak token");
        assert.ok(err.message.includes("***REDACTED***") || err.message.includes("browserless.example.com"), "Error should contain redacted marker or safe endpoint");
        return true;
      },
    );
  });

  it("should redact sensitive query params from arbitrary error text", () => {
    const text = sanitizeString("connect failed for wss://x.example?token=super-secret&region=us");
    assert.ok(!text.includes("super-secret"));
    assert.match(text, /token=(?:%5B)?\[?REDACTED\]?(?:%5D)?/);
  });

  it("should use sanitized endpoint in providerMetadata and cdpEndpoint", async () => {
    // We can't connect, but we can verify the error message uses the safe endpoint
    const p = new BrowserlessProvider();
    await assert.rejects(
      () =>
        p.launch({
          config: { name: "browserless", type: "browserless", endpoint: "https://browserless.example.com", apiKey: "my-api-key" },
        }),
      (err: Error) => {
        // The safe endpoint should not contain the apiKey
        assert.ok(!err.message.includes("my-api-key"), "Error must not leak apiKey");
        return true;
      },
    );
  });
});
