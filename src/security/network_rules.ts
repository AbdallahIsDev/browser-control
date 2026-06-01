import crypto from "node:crypto";
import { logger } from "../shared/logger";
import {
	type StateStorage,
	getStateStorage,
} from "../state/index";
import { redactUrl } from "../observability/redaction";
import type { NetworkEntry } from "../observability/types";
import { DefaultPolicyEngine } from "../policy/engine";
import type { PrivacyProfileName } from "../policy/types";
import trackerProfiles from "./tracker_profiles.json";
export type { PrivacyProfileName } from "../policy/types";

const log = logger.withComponent("network-rules");

// ── Types ───────────────────────────────────────────────────────────

export type RuleType = "allowlist" | "denylist" | "tracker";
export type ResourceType =
	| "script"
	| "stylesheet"
	| "image"
	| "font"
	| "media"
	| "xhr"
	| "fetch"
	| "websocket"
	| "other";

type NetworkRouteRequest = {
	url: () => string;
	method?: () => string;
	resourceType?: () => string;
};

type NetworkRoute = {
	request: () => NetworkRouteRequest;
	abort: (errorCode?: string) => Promise<void>;
	continue: () => Promise<void>;
	fallback?: () => Promise<void>;
};

export interface NetworkRouteEvidence extends NetworkEntry {
	blocked: boolean;
	domain?: string;
	resourceType?: ResourceType;
	matchedRuleId?: string;
	matchedRuleType?: RuleType;
	privacyProfile?: PrivacyProfileName;
}

export interface ApplyNetworkRulesOptions {
	profile?: PrivacyProfileName;
	sessionId?: string;
	recordBlockedRequest?: (entry: NetworkRouteEvidence) => void;
}

export interface NetworkRule {
	id: string;
	pattern: string;
	ruleType: RuleType;
	resourceTypes?: ResourceType[];
	enabled: boolean;
	source: "user" | "built-in" | "profile";
	createdAt: string;
}

export interface PrivacyProfile {
	name: PrivacyProfileName;
	blockTrackers: boolean;
	blockUnknown: boolean;
	trackerProfileKey?: string;
}

export const PRIVACY_PROFILES: Record<PrivacyProfileName, PrivacyProfile> = {
	strict: {
		name: "strict",
		blockTrackers: true,
		blockUnknown: true,
		trackerProfileKey: "trackers-comprehensive",
	},
	balanced: {
		name: "balanced",
		blockTrackers: true,
		blockUnknown: false,
		trackerProfileKey: "trackers-common",
	},
	audit: {
		name: "audit",
		blockTrackers: false,
		blockUnknown: false,
	},
};

// ── Domain Matching ─────────────────────────────────────────────────

function domainMatches(pattern: string, url: string): boolean {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase();
		if (pattern.startsWith("*.")) {
			const suffix = pattern.slice(2).toLowerCase();
			return hostname === suffix || hostname.endsWith("." + suffix);
		}
		return hostname === pattern.toLowerCase();
	} catch {
		return false;
	}
}

function hostnameFromUrl(url: string): string | undefined {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

function detectResourceType(url: string, contentType?: string): ResourceType {
	const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
	switch (ext) {
		case "js":
		case "mjs":
			return "script";
		case "css":
			return "stylesheet";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "webp":
		case "svg":
		case "ico":
			return "image";
		case "woff":
		case "woff2":
		case "ttf":
		case "otf":
			return "font";
		case "mp4":
		case "webm":
		case "mp3":
		case "ogg":
		case "wav":
			return "media";
		default:
			if (contentType?.includes("json") || contentType?.includes("xml")) return "xhr";
			if (url.includes("/api/") || url.includes("graphql")) return "xhr";
			return "other";
	}
}

function normalizeResourceType(value: string | undefined): ResourceType {
	if (value === "xhr") return "xhr";
	if (value === "fetch") return "fetch";
	if (
		value === "script" ||
		value === "stylesheet" ||
		value === "image" ||
		value === "font" ||
		value === "media" ||
		value === "websocket" ||
		value === "other"
	) {
		return value;
	}
	return "other";
}

// ── NetworkRuleEngine ───────────────────────────────────────────────

export class NetworkRuleEngine {
	private storage: StateStorage;
	private policyEngine: DefaultPolicyEngine;
	private loadedBuiltIn = false;

	constructor(storage?: StateStorage, policyEngine?: DefaultPolicyEngine) {
		this.storage = storage ?? getStateStorage();
		this.policyEngine = policyEngine ?? new DefaultPolicyEngine({ profileName: "balanced" });
	}

	private async ensureBuiltInLoaded(): Promise<void> {
		if (this.loadedBuiltIn) return;
		const existing = await this.storage.listNetworkRules();
		const hasBuiltIn = existing.some((r) => r.source === "built-in");
		if (hasBuiltIn) {
			this.loadedBuiltIn = true;
			return;
		}

		const common = (trackerProfiles as Record<string, string[]>)?.["trackers-common"] ?? [];
		const now = new Date().toISOString();
		for (const domain of common) {
			const id = `builtin-tracker-${domain.replace(/[^a-z0-9]/gi, "-")}`;
			const rule = {
				id,
				pattern: domain,
				ruleType: "tracker" as RuleType,
				resourceTypes: [] as ResourceType[],
				enabled: true,
				source: "built-in" as const,
				createdAt: now,
			};
			try {
				await this.storage.saveNetworkRule(rule);
			} catch {
				// Duplicate rule — ignore
			}
		}
		this.loadedBuiltIn = true;
	}

	async addRule(
		pattern: string,
		ruleType: RuleType,
		resourceTypes?: ResourceType[],
	): Promise<NetworkRule> {
		const rule: NetworkRule = {
			id: `rule-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`,
			pattern,
			ruleType,
			resourceTypes: resourceTypes?.length ? resourceTypes : undefined,
			enabled: true,
			source: "user",
			createdAt: new Date().toISOString(),
		};
		await this.storage.saveNetworkRule({
			id: rule.id,
			pattern: rule.pattern,
			ruleType: rule.ruleType,
			resourceTypes: rule.resourceTypes ?? null,
			enabled: true,
			source: rule.source,
			createdAt: rule.createdAt,
		});
		return rule;
	}

	async removeRule(id: string): Promise<boolean> {
		const existing = await this.storage.listNetworkRules();
		const rule = existing.find((r) => r.id === id);
		if (!rule) return false;
		if (rule.source === "built-in") {
			// Disable instead of delete for built-in rules
			await this.storage.saveNetworkRule({
				...rule,
				enabled: false,
			});
			return true;
		}
		await this.storage.deleteNetworkRule(id);
		return true;
	}

	async listRules(): Promise<NetworkRule[]> {
		await this.ensureBuiltInLoaded();
		const stored = await this.storage.listNetworkRules();
		return stored.map((r) => ({
			id: r.id,
			pattern: r.pattern,
			ruleType: r.ruleType as RuleType,
			resourceTypes: (r.resourceTypes ?? undefined) as ResourceType[] | undefined,
			enabled: r.enabled,
			source: (r.source as NetworkRule["source"]) || "user",
			createdAt: r.createdAt,
		}));
	}

	evaluateRequest(
		url: string,
		resourceType?: ResourceType,
		rules?: NetworkRule[],
		profile?: PrivacyProfileName,
	): { decision: "allow" | "block" | "audit"; matchedRule?: NetworkRule } {
		const activeRules = rules ?? [];
		const privacyProfile = profile ?? "balanced";
		const matches = activeRules.filter((rule) => {
			if (!rule.enabled) return false;
			if (!domainMatches(rule.pattern, url)) return false;
			if (
				rule.resourceTypes?.length &&
				resourceType &&
				!rule.resourceTypes.includes(resourceType)
			) {
				return false;
			}
			return true;
		});

		const matchedRule =
			matches.find((rule) => rule.ruleType === "allowlist") ??
			matches.find((rule) => rule.ruleType === "denylist") ??
			matches.find((rule) => rule.ruleType === "tracker");
		const domain = hostnameFromUrl(url);
		const risk = matchedRule?.ruleType === "allowlist"
			? "low"
			: matchedRule || privacyProfile === "strict" ? "moderate" : "low";
		const evaluation = this.policyEngine.evaluate(
			{
				id: `network-${crypto.createHash("sha256").update(url).digest("hex").slice(0, 12)}`,
				path: "network",
				action: "network_request",
				params: {
					url,
					domain,
					resourceType,
					matchedRuleId: matchedRule?.id,
					matchedRuleType: matchedRule?.ruleType,
					privacyProfile,
				},
				risk,
			},
			{ targetDomain: domain },
		);

		if (evaluation.decision === "deny") {
			return { decision: "block", matchedRule };
		}
		if (evaluation.decision === "allow_with_audit") {
			return { decision: "audit", matchedRule };
		}
		return matchedRule ? { decision: "allow", matchedRule } : { decision: "allow" };
	}

	async applyToPage(
		page: {
			route: (
				pattern: string | RegExp,
				handler: (route: unknown) => Promise<void>,
			) => Promise<unknown>;
		},
		options?: PrivacyProfileName | ApplyNetworkRulesOptions,
	): Promise<void> {
		const applyOptions =
			typeof options === "string" ? { profile: options } : (options ?? {});
		const profile = applyOptions.profile ?? "balanced";

		await page.route("**/*", async (route: unknown) => {
			const routeObj = route as NetworkRoute;
			const request = routeObj.request();
			const requestUrl = request.url();
			const resourceType = request.resourceType
				? normalizeResourceType(request.resourceType())
				: detectResourceType(requestUrl);
			const rules = await this.listRules();
			const result = this.evaluateRequest(requestUrl, resourceType, rules, profile);

			if (result.decision === "block") {
				await this.recordBlockedRequest({
					url: requestUrl,
					method: request.method?.() ?? "GET",
					resourceType,
					sessionId: applyOptions.sessionId,
					matchedRule: result.matchedRule,
					profile,
					recordBlockedRequest: applyOptions.recordBlockedRequest,
				});
				await routeObj.abort("blockedbyclient").catch(() => routeObj.abort());
				return;
			}

			if (routeObj.fallback) {
				await routeObj.fallback();
				return;
			}
			await routeObj.continue();
		});
	}

	close(): void {}

	private async recordBlockedRequest(options: {
		url: string;
		method: string;
		resourceType: ResourceType;
		sessionId?: string;
		matchedRule?: NetworkRule;
		profile: PrivacyProfileName;
		recordBlockedRequest?: (entry: NetworkRouteEvidence) => void;
	}): Promise<void> {
		const timestamp = new Date().toISOString();
		const redactedUrl = redactUrl(options.url);
		const entry: NetworkRouteEvidence = {
			url: redactedUrl,
			method: options.method,
			status: 0,
			error: "blocked by network privacy rule",
			timestamp,
			sessionId: options.sessionId,
			blocked: true,
			domain: hostnameFromUrl(options.url),
			resourceType: options.resourceType,
			matchedRuleId: options.matchedRule?.id,
			matchedRuleType: options.matchedRule?.ruleType,
			privacyProfile: options.profile,
			redacted: true,
		};
		options.recordBlockedRequest?.(entry);
		await this.storage.saveAuditEvent({
			id: `network-block-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`,
			action: "network_request_blocked",
			sessionId: options.sessionId,
			policyDecision: "deny",
			details: JSON.stringify({
				url: redactedUrl,
				domain: entry.domain,
				resourceType: entry.resourceType,
				matchedRuleId: entry.matchedRuleId,
				matchedRuleType: entry.matchedRuleType,
				privacyProfile: entry.privacyProfile,
			}),
			timestamp,
		});
	}
}

// ── Singleton ───────────────────────────────────────────────────────

let _defaultEngine: NetworkRuleEngine | null = null;

export function getNetworkRuleEngine(): NetworkRuleEngine {
	if (!_defaultEngine) {
		_defaultEngine = new NetworkRuleEngine();
	}
	return _defaultEngine;
}

export function resetNetworkRuleEngine(): void {
	if (_defaultEngine) {
		_defaultEngine.close();
		_defaultEngine = null;
	}
}
