import type { TradePlan } from "./trade_plan";

export interface RiskDecision {
	allowed: boolean;
	requiresApproval: boolean;
	reason: string;
}

export class RiskEngine {
	constructor(
		private readonly limits: {
			maxLiveRiskPercent?: number;
			minRewardRisk?: number;
		} = {},
	) {}

	canCreateOrderTicket(plan: TradePlan): RiskDecision {
		if (plan.mode === "analysis_only") {
			return {
				allowed: false,
				requiresApproval: false,
				reason: "Analysis-only mode does not create order tickets.",
			};
		}
		if (plan.stopLoss === undefined) {
			return {
				allowed: false,
				requiresApproval: false,
				reason: "Trade plan requires a stop loss before execution.",
			};
		}
		if (plan.targets.length === 0) {
			return {
				allowed: false,
				requiresApproval: false,
				reason: "Trade plan requires at least one target.",
			};
		}
		const maxLiveRisk = this.limits.maxLiveRiskPercent ?? 1;
		if (
			(plan.mode === "live_assisted" || plan.mode === "live_supervised") &&
			plan.riskPercent > maxLiveRisk
		) {
			return {
				allowed: false,
				requiresApproval: true,
				reason: `Live risk ${plan.riskPercent}% exceeds ${maxLiveRisk}%.`,
			};
		}
		if (plan.newsWindow === "near_high_impact") {
			return {
				allowed: false,
				requiresApproval: true,
				reason: "High-impact news window requires explicit approval.",
			};
		}
		return {
			allowed: true,
			requiresApproval: plan.mode === "live_assisted" || plan.mode === "live_supervised",
			reason: "Risk checks passed.",
		};
	}
}
