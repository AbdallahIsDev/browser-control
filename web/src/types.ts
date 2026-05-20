export interface AppStatus {
	daemon?: { state: string };

	broker?: { reachable: boolean };

	browser?: { activeSessions: number; provider: string };

	health?: { overall: string };

	dataHome?: string;

	policyProfile?: string;

	provider?: { active: string };

	tasks?: { queued: number; running: number };
}

export interface Task {
	id: string;

	status: string;

	prompt: string;

	result?: string;
}

export interface TaskListResponse {
	tasks: Task[];

	available: boolean;

	code?: string;

	error?: string;

	recovery?: string;
}

export interface Automation {
	id: string;

	name: string;

	prompt: string;
}

export interface WorkflowDefNode {
	id: string;

	name?: string;

	type?: string;

	kind?: string;

	params?: Record<string, unknown>;

	input?: Record<string, unknown>;

	dependsOn?: string[];

	approvalRequired?: boolean;
}

export interface WorkflowDef {
	id: string;

	name: string;

	description?: string;

	version?: string;

	graph: WorkflowDefNode[];

	createdAt?: string;

	updatedAt?: string;
}

export interface WorkflowRun {
	id: string;

	graphId: string;

	graphName?: string;

	workflowId?: string;

	status: string;

	currentNodeId?: string;

	state?: Record<string, string | number | boolean>;

	nodeResults?: Record<
		string,
		{ status?: string; output?: unknown; error?: string }
	>;

	approvals?: Array<{ nodeId: string; approvedBy: string; approvedAt: string }>;

	artifacts?: Array<{ kind: string; path: string }>;

	failures?: Array<{ nodeId: string; error: string; timestamp: string }>;

	events?: Array<{
		type: string;

		runId: string;

		nodeId?: string;

		timestamp: string;

		data?: unknown;
	}>;

	startedAt?: string;

	updatedAt?: string;

	completedAt?: string;

	sessionId?: string;
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

export type BrowserDialogType = "alert" | "confirm" | "prompt" | "beforeunload";

export interface BrowserDialogInfo {
	id: string;
	type: BrowserDialogType;
	message: string;
	defaultValue?: string;
	frameId?: string;
	createdAt: string;
}

export interface BrowserDialogListResponse {
	success?: boolean;
	data?: {
		dialogs: BrowserDialogInfo[];
	};
	dialogs?: BrowserDialogInfo[];
	error?: string;
}

export interface BrowserDialogRespondResponse {
	success?: boolean;
	data?: {
		handled: boolean;
		dialog: BrowserDialogInfo;
	};
	handled?: boolean;
	dialog?: BrowserDialogInfo;
	error?: string;
}
