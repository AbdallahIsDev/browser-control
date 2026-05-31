import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  closeBrowserResources,
  generateConnectionId,
  getBrowserbaseApiBaseUrl,
  getDefaultProviderProfileManager,
} from "../../../src/providers/utils";

describe("provider utils", () => {
  it("generates compact browser connection IDs", () => {
    assert.match(generateConnectionId(), /^conn-\d+-[a-z0-9]{5}$/u);
  });

  it("normalizes Browserbase API base URL from one shared utility", () => {
    assert.equal(getBrowserbaseApiBaseUrl(), "https://api.browserbase.com/v1");
    assert.equal(
      getBrowserbaseApiBaseUrl({
        name: "browserbase",
        type: "browserbase",
        options: { apiBaseUrl: "https://api.browserbase.test/v1///" },
      }),
      "https://api.browserbase.test/v1",
    );
    assert.equal(
      getBrowserbaseApiBaseUrl({
        name: "browserbase",
        type: "browserbase",
        options: { apiBaseUrl: "   " },
      }),
      "https://api.browserbase.com/v1",
    );
  });

  it("reuses one default profile manager for provider fallbacks", () => {
    assert.equal(getDefaultProviderProfileManager(), getDefaultProviderProfileManager());
  });

  it("closes provider browser resources and swallows teardown errors", async () => {
    const calls: string[] = [];
    await closeBrowserResources({
      context: { close: async () => calls.push("context") },
      browser: { close: async () => calls.push("browser") },
    } as never);
    assert.deepEqual(calls, ["context", "browser"]);

    await closeBrowserResources({
      context: { close: async () => { throw new Error("context failed"); } },
      browser: { close: async () => { throw new Error("browser failed"); } },
    } as never);
  });

  it("can preserve attached contexts while still closing the browser", async () => {
    const calls: string[] = [];
    await closeBrowserResources({
      context: { close: async () => calls.push("context") },
      browser: { close: async () => calls.push("browser") },
    } as never, { closeContext: false });

    assert.deepEqual(calls, ["browser"]);
  });

  it("keeps connection ID generation centralized", () => {
    const providersDir = path.resolve(__dirname, "../../../src/providers");
    const providerFiles = [
      "browserbase.ts",
      "browserless.ts",
      "custom.ts",
      "local.ts",
    ];

    for (const file of providerFiles) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      assert.doesNotMatch(
        source,
        /conn-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2,\s*7\)\}/u,
        `${file} should call generateConnectionId() instead of inlining the generator`,
      );
    }
  });

  it("keeps Browserbase API base URL normalization centralized", () => {
    const providersDir = path.resolve(__dirname, "../../../src/providers");
    const sourceFiles = ["browserbase.ts", "health.ts"];

    for (const file of sourceFiles) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      assert.doesNotMatch(
        source,
        /https:\/\/api\.browserbase\.com\/v1/u,
        `${file} should call getBrowserbaseApiBaseUrl() instead of inlining the default URL`,
      );
      assert.doesNotMatch(
        source,
        /replace\(\/\\\/\+\$\/u,\s*""\)/u,
        `${file} should not duplicate Browserbase API URL normalization`,
      );
    }
  });

  it("keeps provider profile manager construction centralized", () => {
    const providersDir = path.resolve(__dirname, "../../../src/providers");
    const providerFiles = [
      "browserbase.ts",
      "browserless.ts",
      "custom.ts",
      "local.ts",
    ];

    for (const file of providerFiles) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      assert.doesNotMatch(
        source,
        /new BrowserProfileManager/u,
        `${file} should receive a BrowserProfileManager instead of constructing one`,
      );
    }
  });

  it("keeps provider disconnect browser-resource cleanup centralized", () => {
    const providersDir = path.resolve(__dirname, "../../../src/providers");
    const providerFiles = [
      "browserbase.ts",
      "browserless.ts",
      "custom.ts",
      "local.ts",
    ];

    for (const file of providerFiles) {
      const source = fs.readFileSync(path.join(providersDir, file), "utf8");
      assert.match(
        source,
        /closeBrowserResources\(result/u,
        `${file} should use closeBrowserResources() for common teardown`,
      );
      assert.doesNotMatch(
        source,
        /await result\.(context|browser)\.close\(\)/u,
        `${file} should not duplicate context/browser close calls`,
      );
    }
  });
});
