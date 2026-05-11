import assert from "node:assert/strict";
import test from "node:test";
import type { OrderTicket, TradePlan } from "../../src/trading/trade_plan";
import { PaperBrokerAdapter } from "../../src/trading/broker_adapter";
import { requiresLiveOrderApproval, validateOrderTicket } from "../../src/trading/policy";
import { RiskEngine } from "../../src/trading/risk_engine";
import { TradeSupervisor } from "../../src/trading/trade_supervisor";

function plan(overrides: Partial<TradePlan> = {}): TradePlan {
	return {
		id: "plan-1",
		mode: "analysis_only",
		symbol: "EURUSD",
		side: "buy",
		timeframe: "1h",
		thesis: "Bullish sweep and displacement.",
		entry: { type: "limit", price: 1.1 },
		stopLoss: 1.09,
		targets: [{ price: 1.13, sizePercent: 100 }],
		riskPercent: 0.5,
		status: "draft",
		createdAt: "2026-05-08T00:00:00.000Z",
		updatedAt: "2026-05-08T00:00:00.000Z",
		...overrides,
	};
}

test("live order tickets require exact approval fields", () => {
	const ticket: OrderTicket = {
		id: "ticket-1",
		planId: "plan-1",
		mode: "live_assisted",
		account: "funded-1",
		platform: "mt5",
		symbol: "EURUSD",
		side: "buy",
		orderType: "limit",
		size: 1,
		riskPercent: 0.5,
		entry: 1.1,
		stopLoss: 1.09,
		targets: [1.13],
		createdAt: "2026-05-08T00:00:00.000Z",
	};

	assert.equal(requiresLiveOrderApproval(ticket), true);
	const denied = validateOrderTicket(ticket);
	assert.equal(denied.allowed, false);
	assert.equal(denied.requiresApproval, true);
	assert.match(denied.reason, /exact live order approval/i);

	const approved = validateOrderTicket({
		...ticket,
		approval: {
			approvedAt: "2026-05-08T00:01:00.000Z",
			approvedBy: "local-user",
			text:
				"Approved funded-1 MT5 EURUSD buy limit 1 lot entry 1.1 stop 1.09 target 1.13",
		},
	});
	assert.equal(approved.allowed, true);
});

test("risk engine defaults to analysis-only and blocks missing stops", () => {
	const engine = new RiskEngine();
	const analysisPlan = plan();
	assert.equal(engine.canCreateOrderTicket(analysisPlan).allowed, false);
	assert.match(engine.canCreateOrderTicket(analysisPlan).reason, /analysis-only/i);

	const noStop = plan({ mode: "paper", stopLoss: undefined });
	assert.equal(engine.canCreateOrderTicket(noStop).allowed, false);
	assert.match(engine.canCreateOrderTicket(noStop).reason, /stop loss/i);
});

test("paper adapter executes without live approval and supervisor creates stateful decisions", async () => {
	const broker = new PaperBrokerAdapter({ accountId: "paper-1", equity: 10_000 });
	const supervisor = new TradeSupervisor({
		broker,
		analysis: {
			analyze: async () => ({
				symbol: "EURUSD",
				timeframe: "1h",
				thesisValid: true,
				riskState: "normal",
				reason: "Paper setup still valid.",
				confidence: "medium",
			}),
			getChartState: async () => ({ stale: false }),
		},
	});

	const created = await supervisor.openPaperTrade(plan({ mode: "paper" }));
	assert.equal(created.position.status, "open");

	const decision = await supervisor.check(created.trade.id);
	assert.equal(decision.tradeId, created.trade.id);
	assert.equal(decision.decision, "hold");
	assert.equal(decision.requiresApproval, false);
	assert.equal(supervisor.listManagedTrades().length, 1);
});

test("supervisor requires approval before widening stop on live trades", () => {
	const supervisor = new TradeSupervisor({
		broker: new PaperBrokerAdapter(),
		analysis: {
			analyze: async () => ({
				symbol: "EURUSD",
				timeframe: "1h",
				thesisValid: true,
				riskState: "normal",
				reason: "ok",
				confidence: "medium",
			}),
			getChartState: async () => ({ stale: false }),
		},
	});

	const decision = supervisor.reviewStopChange({
		tradeId: "trade-live",
		side: "buy",
		currentStop: 1.09,
		proposedStop: 1.08,
		mode: "live_supervised",
	});
	assert.equal(decision.requiresApproval, true);
	assert.equal(decision.decision, "request_approval");
	assert.match(decision.reason, /wider stop/i);
});
