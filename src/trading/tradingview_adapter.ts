import type { MarketAnalysis } from "./trade_plan";

export interface ChartState {
	stale: boolean;
	symbol?: string;
	timeframe?: string;
	updatedAt?: string;
}

export interface MarketAnalysisAdapter {
	analyze(symbol: string, timeframe: string): Promise<MarketAnalysis>;
	getChartState(symbol?: string): Promise<ChartState>;
}

export class AnalysisOnlyTradingViewAdapter implements MarketAnalysisAdapter {
	async analyze(symbol: string, timeframe: string): Promise<MarketAnalysis> {
		return {
			symbol,
			timeframe,
			thesisValid: false,
			riskState: "normal",
			confidence: "low",
			reason:
				"TradingView MCP analysis adapter is not connected; analysis-only mode is required.",
		};
	}

	async getChartState(symbol?: string): Promise<ChartState> {
		return {
			stale: true,
			symbol,
			updatedAt: new Date().toISOString(),
		};
	}
}
