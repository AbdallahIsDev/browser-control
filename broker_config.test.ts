import assert from "node:assert/strict";
import test from "node:test";

import { loadBrokerConfig } from "./broker_config";

test("loadBrokerConfig parses allowlists and defaults", () => {
  const config = loadBrokerConfig({
    BROKER_PORT: "7788",
    BROKER_SECRET: "test-secret",
    BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com,chat.openai.com",
    BROKER_ALLOWED_TOOLS: "tabs.find,action.click,action.fill",
    BROKER_LOG_DIR: ".logs/broker",
  });

  assert.equal(config.port, 7788);
  assert.deepEqual(config.allowedDomains, [
    "contributor.stock.adobe.com",
    "chat.openai.com",
  ]);
  assert.deepEqual(config.allowedTools, [
    "tabs.find",
    "action.click",
    "action.fill",
  ]);
  assert.equal(config.logDir, ".logs/broker");
  assert.equal(config.defaultSessionTtlSeconds, 1800);
});

test("loadBrokerConfig rejects missing broker secret", () => {
  assert.throws(
    () =>
      loadBrokerConfig({
        BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com",
      }),
    /BROKER_SECRET is required/,
  );
});
