import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	NetworkRuleEngine,
	type NetworkRouteEvidence,
	type NetworkRule,
} from "../../src/security/network_rules";
import { DefaultPolicyEngine } from "../../src/policy/engine";
import { BALANCED_PROFILE } from "../../src/policy/profiles";
import { getStateStorage, resetStateStorage } from "../../src/state/index";

type MockRouteHandler = (route: unknown) => Promise<void>;

describe("NetworkRuleEngine", () => {
	let dataHome: string;
	let originalHome: string | undefined;
	let originalBackend: string | undefined;

	beforeEach(() => {
		originalHome = process.env.BROWSER_CONTROL_HOME;
		originalBackend = process.env.BROWSER_CONTROL_STATE_BACKEND;
		dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-network-rules-"));
		process.env.BROWSER_CONTROL_HOME = dataHome;
		process.env.BROWSER_CONTROL_STATE_BACKEND = "json";
		resetStateStorage();
	});

	afterEach(() => {
		resetStateStorage();
		if (originalHome === undefined) {
			delete process.env.BROWSER_CONTROL_HOME;
		} else {
			process.env.BROWSER_CONTROL_HOME = originalHome;
		}
		if (originalBackend === undefined) {
			delete process.env.BROWSER_CONTROL_STATE_BACKEND;
		} else {
			process.env.BROWSER_CONTROL_STATE_BACKEND = originalBackend;
		}
		fs.rmSync(dataHome, { recursive: true, force: true });
	});

	it("blocks a full URL through one catch-all route and records redacted evidence", async () => {
		const storage = getStateStorage();
		const engine = new NetworkRuleEngine(storage);
		const rule = await engine.addRule("tracker.example", "denylist", ["script"]);
		const routes = new Map<string, MockRouteHandler>();
		const evidence: NetworkRouteEvidence[] = [];
		assert.match(rule.id, /^rule-\d+-[a-f0-9]{32}$/);

		await engine.applyToPage(
			{
				route: async (pattern, handler) => {
					routes.set(String(pattern), handler);
				},
			},
			{
				profile: "balanced",
				sessionId: "session-network",
				recordBlockedRequest: (entry) => evidence.push(entry),
			},
		);

		assert.deepEqual([...routes.keys()], ["**/*"]);

		let abortedWith: string | undefined;
		let continued = false;
		await routes.get("**/*")?.({
			request: () => ({
				url: () => "https://tracker.example/pixel.js?token=raw-secret",
				method: () => "GET",
				resourceType: () => "script",
			}),
			abort: async (code?: string) => {
				abortedWith = code;
			},
			continue: async () => {
				continued = true;
			},
		});

		assert.equal(abortedWith, "blockedbyclient");
		assert.equal(continued, false);
		assert.equal(evidence.length, 1);
		assert.equal(evidence[0].domain, "tracker.example");
		assert.equal(evidence[0].resourceType, "script");
		assert.equal(evidence[0].matchedRuleType, "denylist");
		assert.equal(evidence[0].blocked, true);
		assert.equal(evidence[0].url.includes("raw-secret"), false);

		const auditEvents = await storage.listAuditEvents(10);
		assert.equal(auditEvents[0]?.action, "network_request_blocked");
		assert.match(auditEvents[0]?.id ?? "", /^network-block-\d+-[a-f0-9]{32}$/);
		assert.equal(auditEvents[0]?.details?.includes("raw-secret"), false);
		assert.ok(auditEvents[0]?.details?.includes("tracker.example"));
	});

	it("route handler evaluates rules added after applyToPage", async () => {
		const storage = getStateStorage();
		const engine = new NetworkRuleEngine(storage);
		const routes = new Map<string, MockRouteHandler>();

		await engine.applyToPage({
			route: async (pattern, handler) => {
				routes.set(String(pattern), handler);
			},
		});
		await engine.addRule("late-block.example", "denylist", ["script"]);

		let abortedWith: string | undefined;
		let continued = false;
		await routes.get("**/*")?.({
			request: () => ({
				url: () => "https://late-block.example/app.js",
				method: () => "GET",
				resourceType: () => "script",
			}),
			abort: async (code?: string) => {
				abortedWith = code;
			},
			continue: async () => {
				continued = true;
			},
		});

		assert.equal(abortedWith, "blockedbyclient");
		assert.equal(continued, false);
	});

	it("gives allowlist precedence over denylist and ignores disabled rules", () => {
		const engine = new NetworkRuleEngine();
		const rules: NetworkRule[] = [
			{
				id: "deny",
				pattern: "example.com",
				ruleType: "denylist",
				enabled: true,
				source: "user",
				createdAt: new Date(0).toISOString(),
			},
			{
				id: "allow",
				pattern: "example.com",
				ruleType: "allowlist",
				enabled: true,
				source: "user",
				createdAt: new Date(0).toISOString(),
			},
			{
				id: "disabled",
				pattern: "disabled.example",
				ruleType: "denylist",
				enabled: false,
				source: "user",
				createdAt: new Date(0).toISOString(),
			},
		];

		assert.deepEqual(
			engine.evaluateRequest("https://example.com/app.js", "script", rules),
			{ decision: "allow", matchedRule: rules[1] },
		);
		assert.deepEqual(
			engine.evaluateRequest(
				"https://disabled.example/app.js",
				"script",
				rules,
			),
			{ decision: "allow" },
		);
	});

	it("uses indexed exact and wildcard domain candidates without changing precedence", () => {
		const engine = new NetworkRuleEngine();
		const noiseRules: NetworkRule[] = Array.from({ length: 1_000 }, (_, index) => ({
			id: `noise-${index}`,
			pattern: `noise-${index}.example`,
			ruleType: "denylist",
			enabled: true,
			source: "user",
			createdAt: new Date(index).toISOString(),
		}));
		const wildcardDeny: NetworkRule = {
			id: "wildcard-deny",
			pattern: "*.example.com",
			ruleType: "denylist",
			enabled: true,
			source: "user",
			createdAt: new Date(2_000).toISOString(),
		};
		const imageDeny: NetworkRule = {
			id: "image-deny",
			pattern: "assets.example.com",
			ruleType: "denylist",
			resourceTypes: ["image"],
			enabled: true,
			source: "user",
			createdAt: new Date(2_001).toISOString(),
		};
		const exactDeny: NetworkRule = {
			id: "exact-deny",
			pattern: "assets.example.com",
			ruleType: "denylist",
			enabled: true,
			source: "user",
			createdAt: new Date(2_002).toISOString(),
		};
		const exactAllow: NetworkRule = {
			id: "exact-allow",
			pattern: "assets.example.com",
			ruleType: "allowlist",
			resourceTypes: ["script"],
			enabled: true,
			source: "user",
			createdAt: new Date(2_003).toISOString(),
		};
		const rules = [
			...noiseRules,
			imageDeny,
			wildcardDeny,
			exactDeny,
			exactAllow,
		];

		assert.deepEqual(
			engine.evaluateRequest("https://assets.example.com/app.js", "script", rules),
			{ decision: "allow", matchedRule: exactAllow },
		);
		assert.deepEqual(
			engine.evaluateRequest("https://assets.example.com/logo.png", "image", rules),
			{ decision: "block", matchedRule: imageDeny },
		);
		assert.deepEqual(
			engine.evaluateRequest("https://cdn.example.com/app.js", "script", rules),
			{ decision: "block", matchedRule: wildcardDeny },
		);
	});

	it("uses the audit profile to audit tracker matches without blocking them", () => {
		const engine = new NetworkRuleEngine();
		const trackerRule: NetworkRule = {
			id: "tracker",
			pattern: "tracker.example",
			ruleType: "tracker",
			enabled: true,
			source: "user",
			createdAt: new Date(0).toISOString(),
		};

		assert.deepEqual(
			engine.evaluateRequest(
				"https://tracker.example/track.gif",
				"image",
				[trackerRule],
				"audit",
			),
			{ decision: "audit", matchedRule: trackerRule },
		);
		assert.deepEqual(
			engine.evaluateRequest(
				"https://tracker.example/track.gif",
				"image",
				[trackerRule],
				"balanced",
			),
			{ decision: "block", matchedRule: trackerRule },
		);
	});

	it("uses the policy engine as final authority for network domain decisions", () => {
		const policyEngine = new DefaultPolicyEngine({
			customProfile: {
				...BALANCED_PROFILE,
				name: "network-domain-policy",
				browserPolicy: {
					...BALANCED_PROFILE.browserPolicy,
					blockedDomains: ["policy-blocked.example"],
				},
			},
		});
		const engine = new NetworkRuleEngine(undefined, policyEngine);

		assert.deepEqual(
			engine.evaluateRequest("https://policy-blocked.example/app.js", "script", []),
			{ decision: "block", matchedRule: undefined },
		);
	});
});
