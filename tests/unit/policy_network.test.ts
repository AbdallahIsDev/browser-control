import test from "node:test";
import assert from "node:assert/strict";
import { DefaultPolicyEngine } from "../../src/policy/engine";
import { BALANCED_PROFILE } from "../../src/policy/profiles";

test("Policy engine evaluates network path denylist and strict privacy decisions", () => {
  const policyEngine = new DefaultPolicyEngine({ profileName: "balanced" });

  const denyRuleResult = policyEngine.evaluate({
    id: "network-deny-rule",
    path: "network",
    action: "network_request",
    params: {
      url: "https://tracker.example/pixel.js",
      domain: "tracker.example",
      matchedRuleType: "denylist",
      privacyProfile: "balanced",
    },
    risk: "moderate",
  });
  assert.equal(denyRuleResult.decision, "deny");
  assert.equal(denyRuleResult.matchedRule, "networkRule:denylist");

  const strictResult = policyEngine.evaluate({
    id: "network-strict-unknown",
    path: "network",
    action: "network_request",
    params: {
      url: "https://unknown.example/app.js",
      domain: "unknown.example",
      privacyProfile: "strict",
    },
    risk: "low",
  });
  assert.equal(strictResult.decision, "deny");
  assert.equal(strictResult.matchedRule, "privacyProfile:strict");
});

test("Policy engine audits tracker matches under audit privacy profile", () => {
  const policyEngine = new DefaultPolicyEngine({ profileName: "balanced" });

  const result = policyEngine.evaluate({
    id: "network-audit-tracker",
    path: "network",
    action: "network_request",
    params: {
      url: "https://tracker.example/track.gif",
      domain: "tracker.example",
      matchedRuleType: "tracker",
      privacyProfile: "audit",
    },
    risk: "moderate",
  });

  assert.equal(result.decision, "allow_with_audit");
  assert.equal(result.matchedRule, "networkRule:tracker");
});

test("Policy engine applies browser domain policy to network requests", () => {
  const policyEngine = new DefaultPolicyEngine({
    customProfile: {
      ...BALANCED_PROFILE,
      name: "network-domain-policy",
      browserPolicy: {
        ...BALANCED_PROFILE.browserPolicy,
        blockedDomains: ["blocked.example"],
      },
    },
  });

  const result = policyEngine.evaluate({
    id: "network-blocked-domain",
    path: "network",
    action: "network_request",
    params: {
      url: "https://blocked.example/app.js",
      domain: "blocked.example",
      privacyProfile: "balanced",
    },
    risk: "low",
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.matchedRule, "blockedDomains");
});
