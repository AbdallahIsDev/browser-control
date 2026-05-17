import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BrowserbaseProvider } from "../../../src/providers/browserbase";
import { canAttach, canLaunch } from "../../../src/providers/interface";
import fs from "node:fs";
import path from "node:path";

describe("BrowserbaseProvider", () => {
  const provider = new BrowserbaseProvider();

  it("has Browserbase capabilities", () => {
    assert.equal(provider.name, "browserbase");
    assert.equal(provider.capabilities.supportsCDP, true);
    assert.equal(provider.capabilities.supportsLaunch, true);
    assert.equal(provider.capabilities.supportsAttach, true);
    assert.equal(provider.capabilities.supportsProfiles, false);
    assert.equal(provider.capabilities.supportsStealth, true);
    assert.equal(provider.capabilities.maxConcurrentSessions, 1);
    assert.equal(canLaunch(provider), true);
    assert.equal(canAttach(provider), true);
  });

  it("fails launch without api key or direct connect endpoint", async () => {
    await assert.rejects(
      () => provider.launch({ config: { name: "browserbase", type: "browserbase" } }),
      /Browserbase API key/,
    );
  });

  it("fails attach without session id or endpoint", async () => {
    await assert.rejects(
      () => provider.attach({ config: { name: "browserbase", type: "browserbase", apiKey: "bb-secret" } }),
      /sessionId|endpoint/,
    );
  });

  it("redacts API keys and tokenized connect URLs from failures", async () => {
    await assert.rejects(
      () =>
        provider.attach({
          config: {
            name: "browserbase",
            type: "browserbase",
            endpoint: "wss://connect.browserbase.com?token=super-secret",
            apiKey: "bb-secret",
          },
        }),
      (err: Error) => {
        assert.doesNotMatch(err.message, /super-secret|bb-secret/);
        assert.match(err.message, /browserbase/i);
        return true;
      },
    );
  });

  it("does not store provider config or api keys in public connection metadata", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../src/providers/browserbase.ts"),
      "utf8",
    );

    assert.doesNotMatch(source, /providerConfig:\s*config/u);
    assert.match(source, /WeakMap<ActiveConnection, ProviderConfig>/u);
    assert.match(source, /releaseConfigs\.set/u);
  });
});
