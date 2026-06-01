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

test("Policy engine denies direct IPs that are not explicitly allowed", () => {
  const policyEngine = new DefaultPolicyEngine({
    customProfile: {
      ...BALANCED_PROFILE,
      name: "network-domain-allowlist",
      browserPolicy: {
        ...BALANCED_PROFILE.browserPolicy,
        allowedDomains: ["example.com"],
      },
    },
  });

  const result = policyEngine.evaluate({
    id: "network-direct-ip-not-domain",
    path: "network",
    action: "network_request",
    params: {
      url: "http://93.184.216.34/",
      domain: "93.184.216.34",
      privacyProfile: "balanced",
    },
    risk: "low",
  });

  assert.equal(result.decision, "deny");
  assert.equal(result.matchedRule, "allowedDomains");
});

test("Policy engine matches IP literals and CIDR ranges in domain policies", () => {
  const allowEngine = new DefaultPolicyEngine({
    customProfile: {
      ...BALANCED_PROFILE,
      name: "network-ip-allowlist",
      browserPolicy: {
        ...BALANCED_PROFILE.browserPolicy,
        allowedDomains: ["93.184.216.0/24", "2001:db8::/32"],
      },
    },
  });

  const allowedIpv4 = allowEngine.evaluate({
    id: "network-ipv4-cidr-allowed",
    path: "network",
    action: "network_request",
    params: {
      url: "http://93.184.216.34/",
      domain: "93.184.216.34",
      privacyProfile: "balanced",
    },
    risk: "low",
  });
  assert.equal(allowedIpv4.decision, "allow");

  const allowedIpv6 = allowEngine.evaluate({
    id: "network-ipv6-cidr-allowed",
    path: "network",
    action: "network_request",
    params: {
      url: "http://[2001:db8::42]/",
      domain: "[2001:db8::42]",
      privacyProfile: "balanced",
    },
    risk: "low",
  });
  assert.equal(allowedIpv6.decision, "allow");

  const deniedOutsideRange = allowEngine.evaluate({
    id: "network-ipv4-cidr-denied",
    path: "network",
    action: "network_request",
    params: {
      url: "http://93.184.217.34/",
      domain: "93.184.217.34",
      privacyProfile: "balanced",
    },
    risk: "low",
  });
  assert.equal(deniedOutsideRange.decision, "deny");
  assert.equal(deniedOutsideRange.matchedRule, "allowedDomains");

  const blockEngine = new DefaultPolicyEngine({
    customProfile: {
      ...BALANCED_PROFILE,
      name: "network-ip-blocklist",
      browserPolicy: {
        ...BALANCED_PROFILE.browserPolicy,
        blockedDomains: ["203.0.113.10", "198.51.100.0/24"],
      },
    },
  });

  const blockedExactIp = blockEngine.evaluate({
    id: "network-ip-exact-blocked",
    path: "network",
    action: "network_request",
    params: {
      url: "http://203.0.113.10/",
      domain: "203.0.113.10",
      privacyProfile: "balanced",
    },
    risk: "low",
  });
  assert.equal(blockedExactIp.decision, "deny");
  assert.equal(blockedExactIp.matchedRule, "blockedDomains");

  const blockedCidr = blockEngine.evaluate({
    id: "network-ip-cidr-blocked",
    path: "network",
    action: "network_request",
    params: {
      url: "http://198.51.100.99/",
      domain: "198.51.100.99",
      privacyProfile: "balanced",
    },
    risk: "low",
  });
  assert.equal(blockedCidr.decision, "deny");
  assert.equal(blockedCidr.matchedRule, "blockedDomains");
});
