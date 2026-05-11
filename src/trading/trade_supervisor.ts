import { getStateStorage } from "../state/index";
import type { StateStorage, StoredSupervisorDecision, StoredSupervisorJob } from "../state/index";
import { createOrderTicket } from "./order_ticket";
import { PositionStore } from "./position_store";
import { RiskEngine } from "./risk_engine";
import type {
	ManagedTrade,
	OpenPosition,
	OrderTicket,
	SupervisorDecision,
	TradeMode,
	TradePlan,
	TradeSide,
} from "./trade_plan";
import type { BrokerAdapter } from "./broker_adapter";
import type { MarketAnalysisAdapter } from "./tradingview_adapter";

export interface TradeSupervisorOptions {
	broker: BrokerAdapter;
	analysis: MarketAnalysisAdapter;
	store?: PositionStore;
	riskEngine?: RiskEngine;
	state?: StateStorage;
}

export class TradeSupervisor {
	private readonly store: PositionStore;
	private readonly riskEngine: RiskEngine;
	private readonly state: StateStorage;
	private checkTimer: NodeJS.Timeout | null = null;
	private activeJobs = new Map<string, NodeJS.Timeout>();

	constructor(private readonly options: TradeSupervisorOptions) {
		this.store = options.store ?? new PositionStore();
		this.riskEngine = options.riskEngine ?? new RiskEngine();
		this.state = options.state ?? getStateStorage();
	}

	async start() {
		// Recover managed trades into PositionStore
		await this.recoverActiveTrades();

		// Recover active jobs from storage
		const jobs = await this.state.listSupervisorJobs();
		for (const job of jobs) {
			if (job.status === "active") {
				this.scheduleJob(job);
			}
		}
	}

	private async recoverActiveTrades() {
		const plans = await this.state.listTradePlans();
		const tickets = await this.state.listOrderTickets();
		const jobs = await this.state.listSupervisorJobs();

		for (const job of jobs) {
			if (job.status === "active" || job.status === "paused") {
				const plan = plans.find(
					(p) =>
						p.id === job.tradeId ||
						p.planId === job.tradeId ||
						p.id === job.id.replace("job-", ""),
				);
				const ticket = tickets.find((t) => t.planId === (plan?.planId ?? plan?.id));

				if (plan && ticket) {
					try {
						const recoveredPosition: OpenPosition = {
							id: `recovered-${ticket.id}`,
							ticketId: ticket.id,
							account: ticket.account,
							platform: ticket.platform,
							symbol: ticket.symbol,
							side: ticket.side as TradeSide,
							size: ticket.size,
							entry: ticket.entry ?? 0,
							stopLoss: ticket.stopLoss ?? 0,
							targets: ticket.targets,
							status: "open",
							openedAt: ticket.createdAt,
						};
						const recoveredPlan: TradePlan = {
							id: plan.planId || plan.id,
							mode: plan.mode as TradeMode,
							symbol: plan.symbol,
							side: plan.side as TradeSide,
							timeframe: "1h",
							thesis: plan.thesis,
							entry: { type: "market" },
							targets: [],
							riskPercent: plan.riskPercent,
							status: plan.status as "draft" | "approved" | "open" | "closed" | "cancelled",
							createdAt: plan.createdAt,
							updatedAt: plan.updatedAt,
						};
						const recoveredTicket: OrderTicket = {
							id: ticket.id,
							planId: ticket.planId,
							mode: ticket.mode as TradeMode,
							account: ticket.account,
							platform: ticket.platform,
							symbol: ticket.symbol,
							side: ticket.side as TradeSide,
							orderType: "market",
							size: ticket.size,
							riskPercent: plan.riskPercent,
							entry: ticket.entry,
							stopLoss: ticket.stopLoss,
							targets: ticket.targets,
							createdAt: ticket.createdAt,
						};
						const trade: ManagedTrade = {
							id: job.tradeId,
							plan: recoveredPlan,
							ticket: recoveredTicket,
							position: recoveredPosition,
							supervisorIntervalSeconds: job.interval,
							status: job.status === "active" ? "active" : "paused",
						};
						this.store.upsert(trade);
					} catch (e) {
						console.error(`Failed to recover trade ${job.tradeId}:`, e);
					}
				}
			}
		}
	}

	async stop() {
		for (const timer of this.activeJobs.values()) {
			clearTimeout(timer);
		}
		this.activeJobs.clear();
	}

	async pauseJob(jobId: string) {
		const jobs = await this.state.listSupervisorJobs();
		const job = jobs.find((j) => j.id === jobId);
		if (job) {
			job.status = "paused";
			await this.state.saveSupervisorJob(job);
			const timer = this.activeJobs.get(jobId);
			if (timer) {
				clearTimeout(timer);
				this.activeJobs.delete(jobId);
			}
		}
	}

	async resumeJob(jobId: string) {
		const jobs = await this.state.listSupervisorJobs();
		const job = jobs.find((j) => j.id === jobId);
		if (job && job.status === "paused") {
			job.status = "active";
			await this.state.saveSupervisorJob(job);
			this.scheduleJob(job);
		}
	}

	async stopJob(jobId: string) {
		const jobs = await this.state.listSupervisorJobs();
		const job = jobs.find((j) => j.id === jobId);
		if (job) {
			job.status = "stopped";
			await this.state.saveSupervisorJob(job);
			const timer = this.activeJobs.get(jobId);
			if (timer) {
				clearTimeout(timer);
				this.activeJobs.delete(jobId);
			}
		}
	}

	private scheduleJob(job: StoredSupervisorJob) {
		if (this.activeJobs.has(job.id)) {
			clearTimeout(this.activeJobs.get(job.id));
		}
		if (job.status !== "active") return;

		const timer = setTimeout(
			() => this.runJob(job.id),
			job.interval * 1000,
		);
		// Ensure timer doesn't keep process alive in tests if not needed
		if (typeof timer.unref === "function") {
			timer.unref();
		}
		this.activeJobs.set(job.id, timer);
	}

	private async runJob(jobId: string) {
		const jobs = await this.state.listSupervisorJobs();
		const job = jobs.find((j) => j.id === jobId);
		if (!job || job.status !== "active") return;

		try {
			const decision = await this.check(job.tradeId);
			await this.saveDecision(job.tradeId, decision);
			
			// Update job last check
			job.lastCheck = new Date().toISOString();
			await this.state.saveSupervisorJob(job);
		} catch (error) {
			console.error(`[SUPERVISOR] Job ${jobId} failed:`, error);
		}

		// Re-schedule
		this.scheduleJob(job);
	}

	private async saveDecision(tradeId: string, decision: SupervisorDecision) {
		const stored: StoredSupervisorDecision = {
			id: `dec-${Date.now()}`,
			tradeId,
			decision: decision.decision,
			confidence: decision.confidence,
			riskState: decision.riskState,
			reason: decision.reason,
			requiresApproval: decision.requiresApproval,
			proposedActions: decision.proposedActions?.map(a => JSON.stringify(a)),
			createdAt: new Date().toISOString(),
		};
		await this.state.saveSupervisorDecision(stored);
	}

	async openPaperTrade(
		plan: TradePlan,
	): Promise<{ trade: ManagedTrade; position: OpenPosition }> {
		if (plan.mode !== "paper") {
			throw new Error("openPaperTrade only accepts paper mode plans.");
		}
		const risk = this.riskEngine.canCreateOrderTicket(plan);
		if (!risk.allowed) throw new Error(risk.reason);
		const ticket = createOrderTicket(plan, {
			account: "paper",
			platform: "paper",
			size: 1,
		});
		const position = await this.options.broker.placeOrder(ticket);
		const trade: ManagedTrade = {
			id: `trade-${Date.now()}-${position.id}`,
			plan,
			ticket,
			position,
			supervisorIntervalSeconds: 60,
			status: "active",
			nextCheckAt: new Date(Date.now() + 60_000).toISOString(),
		};
		this.store.upsert(trade);

		// Create durable job
		const job: StoredSupervisorJob = {
			id: `job-${trade.id}`,
			tradeId: trade.id,
			symbol: plan.symbol,
			side: plan.side,
			mode: plan.mode,
			interval: trade.supervisorIntervalSeconds,
			status: "active",
			decidedAt: new Date().toISOString(),
			createdAt: new Date().toISOString(),
		};
		await this.state.saveSupervisorJob(job);
		this.scheduleJob(job);

		return { trade, position };
	}

	async check(tradeId: string): Promise<SupervisorDecision> {
		const trade = this.store.get(tradeId);
		if (!trade) throw new Error(`Managed trade not found: ${tradeId}`);
		const chart = await this.options.analysis.getChartState(trade.plan.symbol);
		if (chart.stale) {
			return {
				tradeId,
				decision: "alert",
				confidence: "medium",
				reason: "Chart state is stale or unavailable.",
				riskState: "elevated",
				requiresApproval: false,
				proposedActions: [],
			};
		}
		const analysis = await this.options.analysis.analyze(
			trade.plan.symbol,
			trade.plan.timeframe,
		);
		const now = new Date();
		trade.lastCheckAt = now.toISOString();
		trade.nextCheckAt = new Date(
			now.getTime() + trade.supervisorIntervalSeconds * 1000,
		).toISOString();
		this.store.upsert(trade);

		if (!analysis.thesisValid) {
			return {
				tradeId,
				decision: "request_approval",
				confidence: analysis.confidence,
				reason: analysis.reason,
				riskState: analysis.riskState,
				requiresApproval: true,
				proposedActions: [{ action: "close", positionId: trade.position.id }],
			};
		}

		return {
			tradeId,
			decision: "hold",
			confidence: analysis.confidence,
			reason: analysis.reason,
			riskState: analysis.riskState,
			requiresApproval: false,
			proposedActions: [],
		};
	}

	reviewStopChange(input: {
		tradeId: string;
		side: TradeSide;
		currentStop: number;
		proposedStop: number;
		mode: TradeMode;
	}): SupervisorDecision {
		const wider =
			input.side === "buy"
				? input.proposedStop < input.currentStop
				: input.proposedStop > input.currentStop;
		const live =
			input.mode === "live_assisted" || input.mode === "live_supervised";
		if (live && wider) {
			return {
				tradeId: input.tradeId,
				decision: "request_approval",
				confidence: "high",
				reason: "Moving a live wider stop requires approval.",
				riskState: "elevated",
				requiresApproval: true,
				proposedActions: [
					{
						action: "move_stop",
						stopLoss: input.proposedStop,
					},
				],
			};
		}
		return {
			tradeId: input.tradeId,
			decision: "move_stop",
			confidence: "medium",
			reason: "Stop change reduces or preserves risk.",
			riskState: "normal",
			requiresApproval: false,
			proposedActions: [{ action: "move_stop", stopLoss: input.proposedStop }],
		};
	}

	listManagedTrades(): ManagedTrade[] {
		return this.store.list();
	}
}
