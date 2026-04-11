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

test("loadBrokerConfig rejects unknown broker tool names", () => {
  assert.throws(
    () =>
      loadBrokerConfig({
        BROKER_SECRET: "test-secret",
        BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com",
        BROKER_ALLOWED_TOOLS: "tabs.find,action.delete",
      }),
    /BROKER_ALLOWED_TOOLS contains unsupported tool "action.delete"/,
  );
});

test("loadBrokerConfig rejects blank broker allowed tools", () => {
  assert.throws(
    () =>
      loadBrokerConfig({
        BROKER_SECRET: "test-secret",
        BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com",
        BROKER_ALLOWED_TOOLS: "",
      }),
    /BROKER_ALLOWED_TOOLS must not be empty/,
  );
});

test("loadBrokerConfig rejects non-numeric broker port", () => {
  assert.throws(
    () =>
      loadBrokerConfig({
        BROKER_PORT: "abc",
        BROKER_SECRET: "test-secret",
        BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com",
      }),
    /BROKER_PORT must be a positive integer/,
  );
});

test("loadBrokerConfig rejects out-of-range broker port", () => {
  assert.throws(
    () =>
      loadBrokerConfig({
        BROKER_PORT: "70000",
        BROKER_SECRET: "test-secret",
        BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com",
      }),
    /BROKER_PORT must be an integer between 1 and 65535/,
  );
});

test("loadBrokerConfig rejects non-positive numeric env values", () => {
  assert.throws(
    () =>
      loadBrokerConfig({
        BROKER_SECRET: "test-secret",
        BROKER_ALLOWED_DOMAINS: "contributor.stock.adobe.com",
        BROKER_MAX_REQUESTS_PER_SESSION: "0",
      }),
    /BROKER_MAX_REQUESTS_PER_SESSION must be a positive integer/,
  );
});
