import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CustomBrowserProvider } from "./custom";
import { canLaunch, canAttach } from "./interface";

describe("CustomBrowserProvider", () => {
  const provider = new CustomBrowserProvider();

  it("should have correct name and capabilities", () => {
    assert.equal(provider.name, "custom");
    assert.equal(provider.capabilities.supportsCDP, true);
    assert.equal(provider.capabilities.supportsLaunch, false);
    assert.equal(provider.capabilities.supportsAttach, true);
    assert.equal(provider.capabilities.supportsProfiles, false);
    assert.equal(provider.capabilities.supportsStealth, false);
    assert.equal(provider.capabilities.maxConcurrentSessions, 1);
  });

  it("should support attach but not launch", () => {
    assert.equal(canLaunch(provider), false);
    assert.equal(canAttach(provider), true);
  });

  it("should fail to attach without endpoint", async () => {
    await assert.rejects(
      () => provider.attach({ config: { name: "custom", type: "custom" } }),
      (err: Error) => {
        assert.ok(err.message.includes("endpoint"));
        return true;
      },
    );
  });

  it("should fail to attach with invalid endpoint", async () => {
    await assert.rejects(
      () =>
        provider.attach({
          config: { name: "custom", type: "custom", endpoint: "not-a-url" },
        }),
      (err: Error) => {
        assert.ok(err.message.includes("Invalid endpoint"));
        return true;
      },
    );
  });

  it("should redact sensitive endpoint params in connection errors", async () => {
    await assert.rejects(
      () => provider.attach({ cdpUrl: "ws://127.0.0.1:9?token=super-secret" }),
      (err: Error) => {
        assert.ok(!err.message.includes("super-secret"), "Error must not leak token");
        assert.ok(err.message.includes("token=***REDACTED***") || !err.message.includes("token="));
        return true;
      },
    );
  });
});
