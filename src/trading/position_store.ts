import type { ManagedTrade } from "./trade_plan";

export class PositionStore {
	private readonly trades = new Map<string, ManagedTrade>();

	upsert(trade: ManagedTrade): ManagedTrade {
		this.trades.set(trade.id, trade);
		return trade;
	}

	get(tradeId: string): ManagedTrade | undefined {
		return this.trades.get(tradeId);
	}

	list(): ManagedTrade[] {
		return [...this.trades.values()];
	}
}
