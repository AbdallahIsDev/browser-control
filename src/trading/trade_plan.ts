export type TradeMode =
	| "analysis_only"
	| "paper"
	| "live_assisted"
	| "live_supervised";

export type TradeSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type TradeStatus = "draft" | "approved" | "open" | "closed" | "cancelled";

export interface TradeTarget {
	price: number;
	sizePercent: number;
}

export interface TradePlan {
	id: string;
	mode: TradeMode;
	symbol: string;
	side: TradeSide;
	timeframe: string;
	thesis: string;
	entry: {
		type: OrderType;
		price?: number;
	};
	stopLoss?: number;
	targets: TradeTarget[];
	riskPercent: number;
	status: TradeStatus;
	createdAt: string;
	updatedAt: string;
	newsWindow?: "clear" | "near_high_impact" | "unknown";
}

export interface LiveApproval {
	approvedAt: string;
	approvedBy: string;
	text: string;
}

export interface OrderTicket {
	id: string;
	planId: string;
	mode: TradeMode;
	account: string;
	platform: string;
	symbol: string;
	side: TradeSide;
	orderType: OrderType;
	size: number;
	riskPercent: number;
	entry?: number;
	stopLoss?: number;
	targets: number[];
	createdAt: string;
	approval?: LiveApproval;
}

export interface OpenPosition {
	id: string;
	ticketId: string;
	account: string;
	platform: string;
	symbol: string;
	side: TradeSide;
	size: number;
	entry: number;
	stopLoss: number;
	targets: number[];
	status: "open" | "closed";
	openedAt: string;
	closedAt?: string;
}

export interface ManagedTrade {
	id: string;
	plan: TradePlan;
	ticket: OrderTicket;
	position: OpenPosition;
	supervisorIntervalSeconds: number;
	lastCheckAt?: string;
	nextCheckAt?: string;
	status: "active" | "paused" | "closed";
}

export interface SupervisorDecision {
	tradeId: string;
	decision:
		| "hold"
		| "alert"
		| "move_stop"
		| "take_partial"
		| "close"
		| "request_approval"
		| "pause_supervisor"
		| "halt_trading";
	confidence: "low" | "medium" | "high";
	reason: string;
	riskState: "normal" | "elevated" | "critical";
	requiresApproval: boolean;
	proposedActions: Array<Record<string, unknown>>;
}

export interface MarketAnalysis {
	symbol: string;
	timeframe: string;
	thesisValid: boolean;
	riskState: "normal" | "elevated" | "critical";
	reason: string;
	confidence: "low" | "medium" | "high";
}
