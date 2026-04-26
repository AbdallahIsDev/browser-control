import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LocalBrowserProvider } from "../../../src/providers/local";
import { canLaunch, canAttach } from "../../../src/providers/interface";

describe("LocalBrowserProvider", () => {
  const provider = new LocalBrowserProvider();

  it("should have correct name and capabilities", () => {
    assert.equal(provider.name, "local");
    assert.equal(provider.capabilities.supportsCDP, true);
    assert.equal(provider.capabilities.supportsLaunch, true);
    assert.equal(provider.capabilities.supportsAttach, true);
    assert.equal(provider.capabilities.supportsProfiles, true);
    assert.equal(provider.capabilities.supportsStealth, true);
    assert.equal(provider.capabilities.maxConcurrentSessions, 1);
  });

  it("should support all connection modes", () => {
    assert.equal(canLaunch(provider), true);
    assert.equal(canAttach(provider), true);
  });

  it("should not throw on disconnect with null context", async () => {
    await assert.doesNotReject(() =>
      provider.disconnect({
        browser: null as unknown as import("playwright").Browser,
        context: null,
        connection: {
          id: "test",
          mode: "managed",
          profile: {
            id: "p1",
            name: "default",
            type: "shared",
            dataDir: "/tmp",
            createdAt: "",
            lastUsedAt: "",
          },
          cdpEndpoint: "http://localhost:9222",
          status: "connected",
          connectedAt: "",
          tabCount: 0,
          targetType: "chrome",
          isRealBrowser: false,
          provider: "local",
        },
      }),
    );
  });
});
