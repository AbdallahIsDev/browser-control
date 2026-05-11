import type { OrderTicket } from "./trade_plan";

export interface TradingPolicyDecision {
	allowed: boolean;
	requiresApproval: boolean;
	reason: string;
}

const LIVE_MODES = new Set(["live_assisted", "live_supervised"]);

export function requiresLiveOrderApproval(ticket: OrderTicket): boolean {
	return LIVE_MODES.has(ticket.mode);
}

function approvalMentions(ticket: OrderTicket, value: string | number | undefined): boolean {
	if (value === undefined) return false;
	return ticket.approval?.text.toLowerCase().includes(String(value).toLowerCase()) === true;
}

export function validateOrderTicket(ticket: OrderTicket): TradingPolicyDecision {
	if (!ticket.symbol || !ticket.side || !ticket.orderType) {
		return {
			allowed: false,
			requiresApproval: false,
			reason: "Order ticket is missing symbol, side, or order type.",
		};
	}
	if (!ticket.stopLoss) {
		return {
			allowed: false,
			requiresApproval: false,
			reason: "Order ticket requires a defined stop loss.",
		};
	}
	if (ticket.targets.length === 0) {
		return {
			allowed: false,
			requiresApproval: false,
			reason: "Order ticket requires at least one target.",
		};
	}
	if (ticket.riskPercent > 1 && requiresLiveOrderApproval(ticket)) {
		return {
			allowed: false,
			requiresApproval: true,
			reason: "Live trade risk exceeds the default 1 percent limit.",
		};
	}
	if (!requiresLiveOrderApproval(ticket)) {
		return { allowed: true, requiresApproval: false, reason: "Paper/demo order allowed." };
	}
	if (!ticket.approval) {
		return {
			allowed: false,
			requiresApproval: true,
			reason: "Live order requires exact live order approval.",
		};
	}

	const required = [
		ticket.account,
		ticket.platform,
		ticket.symbol,
		ticket.side,
		ticket.orderType,
		ticket.size,
		ticket.entry,
		ticket.stopLoss,
		...ticket.targets,
	];
	const missing = required.filter((value) => !approvalMentions(ticket, value));
	if (missing.length > 0) {
		return {
			allowed: false,
			requiresApproval: true,
			reason: `Live order approval is missing exact fields: ${missing.join(", ")}.`,
		};
	}
	return { allowed: true, requiresApproval: false, reason: "Exact live order approved." };
}
