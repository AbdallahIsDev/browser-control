import type { OrderTicket, TradePlan } from "./trade_plan";

export function createOrderTicket(
	plan: TradePlan,
	input: {
		id?: string;
		account?: string;
		platform?: string;
		size?: number;
		entry?: number;
		createdAt?: string;
	},
): OrderTicket {
	const now = input.createdAt ?? new Date().toISOString();
	return {
		id: input.id ?? `ticket-${Date.now()}`,
		planId: plan.id,
		mode: plan.mode,
		account: input.account ?? "paper",
		platform: input.platform ?? (plan.mode === "paper" ? "paper" : "unknown"),
		symbol: plan.symbol,
		side: plan.side,
		orderType: plan.entry.type,
		size: input.size ?? 1,
		riskPercent: plan.riskPercent,
		entry: input.entry ?? plan.entry.price,
		stopLoss: plan.stopLoss,
		targets: plan.targets.map((target) => target.price),
		createdAt: now,
	};
}
