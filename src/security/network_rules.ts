import crypto from "node:crypto";
import { logger } from "../shared/logger";
import {
	type StateStorage,
	getStateStorage,
} from "../state/index";
import trackerProfiles from "./tracker_profiles.json";

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

export interface NetworkRule {
	id: string;
	pattern: string;
	ruleType: RuleType;
	resourceTypes?: ResourceType[];
	enabled: boolean;
	source: "user" | "built-in" | "profile";
	createdAt: string;
}

export type PrivacyProfileName = "strict" | "balanced" | "audit";

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

// ── NetworkRuleEngine ───────────────────────────────────────────────

export class NetworkRuleEngine {
	private storage: StateStorage;
	private loadedBuiltIn = false;

	constructor(storage?: StateStorage) {
		this.storage = storage ?? getStateStorage();
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
			id: `rule-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
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
		const privacyConfig = PRIVACY_PROFILES[profile ?? "balanced"];

		for (const rule of activeRules) {
			if (!rule.enabled) continue;
			if (!domainMatches(rule.pattern, url)) continue;
			if (
				rule.resourceTypes?.length &&
				resourceType &&
				!rule.resourceTypes.includes(resourceType)
			) {
				continue;
			}

			if (rule.ruleType === "denylist" || rule.ruleType === "tracker") {
				return { decision: "block", matchedRule: rule };
			}
			if (rule.ruleType === "allowlist") {
				return { decision: "allow", matchedRule: rule };
			}
		}

		if (privacyConfig.blockUnknown) {
			return { decision: "block" };
		}

		return { decision: "allow" };
	}

	async applyToPage(
		page: { route: (pattern: string | RegExp, handler: (route: unknown) => Promise<void>) => Promise<void> },
		profile?: PrivacyProfileName,
	): Promise<void> {
		const rules = await this.listRules();
		const privacyConfig = PRIVACY_PROFILES[profile ?? "balanced"];

		if (!privacyConfig.blockTrackers) return;

		const trackerPatterns = rules
			.filter((r) => r.enabled && (r.ruleType === "denylist" || r.ruleType === "tracker"))
			.map((r) => r.pattern);

		for (const pattern of trackerPatterns) {
			const regex = domainToRegex(pattern);
			await page.route(regex, async (route: unknown) => {
				const routeObj = route as { request(): { url(): string }; abort(): Promise<void> };
				const requestUrl = routeObj.request().url();
				const resourceType = detectResourceType(requestUrl);
				const result = this.evaluateRequest(requestUrl, resourceType, rules, profile);
				if (result.decision === "block") {
					await routeObj.abort();
				} else {
					const continueRoute = route as { continue(): Promise<void> };
					await continueRoute.continue();
				}
			});
		}
	}

	close(): void {}
}

// ── Helpers ─────────────────────────────────────────────────────────

function domainToRegex(pattern: string): RegExp {
	if (pattern.startsWith("*.")) {
		const suffix = pattern.slice(2).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(^|\\.)${suffix}$`);
	}
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}$`);
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
