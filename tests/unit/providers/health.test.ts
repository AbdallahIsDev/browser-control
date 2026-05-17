import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkProviderHealth, scoreProviderHealth } from "../../../src/providers/health";

describe("provider health scoring", () => {
  it("reports readable Browserbase auth failure without leaking token", async () => {
    const report = await checkProviderHealth(
      {
        name: "browserbase",
        type: "browserbase",
        apiKey: "bb-secret",
        options: { apiBaseUrl: "https://api.browserbase.test/v1" },
      },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "bad bb-secret" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      },
    );

    assert.equal(report.ok, false);
    assert.equal(report.authValid, false);
    assert.equal(report.endpointReachable, false);
    assert.equal(report.launchSupported, true);
    assert.equal(report.attachSupported, true);
    assert.doesNotMatch(JSON.stringify(report), /bb-secret/);
    assert.match(report.summary, /browserbase/i);
    assert.match(report.summary, /401/);
  });

  it("scores local provider higher than unreachable remote provider", async () => {
    const local = await checkProviderHealth({ name: "local", type: "local" });
    const remote = await checkProviderHealth(
      { name: "custom", type: "custom", endpoint: "https://remote.example.test" },
      {
        fetchImpl: async () => {
          throw new Error("network down");
        },
      },
    );

    assert.ok(scoreProviderHealth(local) > scoreProviderHealth(remote));
    assert.equal(remote.endpointReachable, false);
    assert.match(remote.summary, /network down/);
  });

  it("reports sandbox providers as explicit unsupported extension points", async () => {
    const report = await checkProviderHealth({
      name: "e2b",
      type: "e2b",
      endpoint: "https://sandbox.example.test",
      apiKey: "sandbox-secret",
    });

    assert.equal(report.ok, false);
    assert.equal(report.state, "unhealthy");
    assert.equal(report.launchSupported, false);
    assert.equal(report.attachSupported, false);
    assert.equal(report.endpointReachable, false);
    assert.match(report.summary, /not implemented|adapter/i);
    assert.doesNotMatch(JSON.stringify(report), /sandbox-secret/);
  });

  it("reports anti-detect providers as unsupported high-risk extension points", async () => {
    const report = await checkProviderHealth({
      name: "camofox",
      type: "camofox",
      endpoint: "https://camofox.example.test",
    });

    assert.equal(report.ok, false);
    assert.equal(report.launchSupported, false);
    assert.equal(report.attachSupported, false);
    assert.match(report.summary, /not implemented|adapter/i);
  });
});
