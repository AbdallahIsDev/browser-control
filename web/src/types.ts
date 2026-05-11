export interface AppStatus {
	daemon?: { state: string };
	broker?: { reachable: boolean };
	browser?: { activeSessions: number; provider: string };
	health?: { overall: string };
	dataHome?: string;
}

export interface Task {
	id: string;
	status: string;
	prompt: string;
	result?: string;
}

export interface Automation {
	id: string;
	name: string;
	prompt: string;
}

export interface WorkflowDef {
	id: string;
	name: string;
}

export interface WorkflowRun {
	id: string;
	workflowId: string;
	status: string;
}

export interface PackageDef {
	id: string;
	name: string;
	version: string;
}

export interface PackageEval {
	id: string;
	packageId: string;
	status: string;
}

export interface EvidenceRecord {
	id: string;
	type: string;
	path: string;
	createdAt?: string;
}

export interface TradePlan {
	id: string;
	symbol: string;
	side: "buy" | "sell";
	mode: "analysis_only" | "paper" | "live_assisted" | "live_supervised";
	status: "draft" | "active" | "completed" | "cancelled";
	thesis: string;
}

export interface OrderTicket {
	id: string;
	planId: string;
	symbol: string;
	status: string;
}

export interface SupervisorJob {
	id: string;
	status: "active" | "paused" | "stopped" | "completed";
	planId: string;
}

export interface SupervisorDecision {
	id: string;
	jobId: string;
	decision: string;
	reason?: string;
	createdAt?: string;
}

export interface JournalEntry {
	id: string;
	timestamp: string;
	message: string;
	evidencePath?: string;
}

export interface TradingStatus {
	mode: "analysis_only" | "paper" | "live_assisted" | "live_supervised";
	connection: string;
	staleChart: boolean;
}
