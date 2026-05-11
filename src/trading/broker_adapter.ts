import type { OpenPosition, OrderTicket } from "./trade_plan";
import { validateOrderTicket } from "./policy";

export interface AccountRisk {
	accountId: string;
	equity: number;
	dailyDrawdownPercent: number;
	weeklyDrawdownPercent: number;
}

export interface BrokerAdapter {
	listPositions(): Promise<OpenPosition[]>;
	placeOrder(ticket: OrderTicket): Promise<OpenPosition>;
	modifyOrder(positionId: string, changes: { stopLoss?: number; targets?: number[] }): Promise<OpenPosition>;
	closePosition(positionId: string): Promise<OpenPosition>;
	accountRisk(): Promise<AccountRisk>;
}

export class PaperBrokerAdapter implements BrokerAdapter {
	private readonly positions = new Map<string, OpenPosition>();

	constructor(
		private readonly options: { accountId?: string; equity?: number } = {},
	) {}

	async listPositions(): Promise<OpenPosition[]> {
		return [...this.positions.values()];
	}

	async placeOrder(ticket: OrderTicket): Promise<OpenPosition> {
		const policy = validateOrderTicket(ticket);
		if (!policy.allowed) throw new Error(policy.reason);
		const entry = ticket.entry ?? 0;
		const stopLoss = ticket.stopLoss;
		if (stopLoss === undefined) throw new Error("Paper order requires stop loss.");
		const position: OpenPosition = {
			id: `paper-pos-${Date.now()}-${this.positions.size + 1}`,
			ticketId: ticket.id,
			account: this.options.accountId ?? ticket.account,
			platform: "paper",
			symbol: ticket.symbol,
			side: ticket.side,
			size: ticket.size,
			entry,
			stopLoss,
			targets: [...ticket.targets],
			status: "open",
			openedAt: new Date().toISOString(),
		};
		this.positions.set(position.id, position);
		return position;
	}

	async modifyOrder(
		positionId: string,
		changes: { stopLoss?: number; targets?: number[] },
	): Promise<OpenPosition> {
		const position = this.positions.get(positionId);
		if (!position) throw new Error(`Position not found: ${positionId}`);
		const next = {
			...position,
			...(changes.stopLoss !== undefined ? { stopLoss: changes.stopLoss } : {}),
			...(changes.targets ? { targets: [...changes.targets] } : {}),
		};
		this.positions.set(positionId, next);
		return next;
	}

	async closePosition(positionId: string): Promise<OpenPosition> {
		const position = this.positions.get(positionId);
		if (!position) throw new Error(`Position not found: ${positionId}`);
		const next: OpenPosition = {
			...position,
			status: "closed",
			closedAt: new Date().toISOString(),
		};
		this.positions.set(positionId, next);
		return next;
	}

	async accountRisk(): Promise<AccountRisk> {
		return {
			accountId: this.options.accountId ?? "paper",
			equity: this.options.equity ?? 100_000,
			dailyDrawdownPercent: 0,
			weeklyDrawdownPercent: 0,
		};
	}
}
