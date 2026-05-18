import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "../api";
import type { WorkflowDef, WorkflowRun } from "../types";

const workflowNodeKinds = new Set([
	"browser",
	"terminal",
	"filesystem",
	"approval",
	"wait",
	"assertion",
	"verification",
	"helper",
]);

function normalizeWorkflowNodeKind(workflow: WorkflowDef, nodeId: string) {
	const node = workflow.graph.find((item) => item.id === nodeId);
	const raw = String(node?.kind ?? node?.type ?? "browser").toLowerCase();
	if (workflowNodeKinds.has(raw)) return raw;
	if (
		raw.includes("terminal") ||
		raw.includes("command") ||
		raw.includes("shell")
	) {
		return "terminal";
	}
	if (raw.includes("file") || raw.includes("fs")) return "filesystem";
	if (raw.includes("approval")) return "approval";
	if (raw.includes("wait") || raw.includes("delay")) return "wait";
	if (raw.includes("assert")) return "assertion";
	if (raw.includes("verify")) return "verification";
	if (raw.includes("helper")) return "helper";
	return "browser";
}

function toRuntimeWorkflowGraph(workflow: WorkflowDef) {
	const nodes = workflow.graph.map((node) => {
		const input = { ...(node.params ?? {}), ...(node.input ?? {}) };
		if (node.type && !("action" in input)) input.action = node.type;
		if (node.approvalRequired && !("approvalRequired" in input)) {
			input.approvalRequired = true;
		}
		return {
			id: node.id,
			name: node.name,
			kind: normalizeWorkflowNodeKind(workflow, node.id),
			input,
		};
	});
	const edges = workflow.graph.flatMap((node) =>
		(node.dependsOn ?? []).map((dependsOn) => ({
			from: dependsOn,
			to: node.id,
		})),
	);
	const nodesWithIncoming = new Set(edges.map((edge) => edge.to));
	const entryNodeId =
		nodes.find((node) => !nodesWithIncoming.has(node.id))?.id ?? nodes[0]?.id;

	return {
		id: workflow.id,
		name: workflow.name,
		version: workflow.version ?? "1",
		nodes,
		edges,
		entryNodeId,
	};
}

interface HarnessHelper {
	id: string;
	taskTags: string[];
	failureTypes: string[];
	purpose: string;
	version: string;
	activated: boolean;
	files: string[];
}

interface ValidationCheck {
	name: string;
	status: "passed" | "failed";
	message?: string;
}

interface ValidationResult {
	helperId: string;
	status: "passed" | "failed";
	checks: ValidationCheck[];
}

interface WorkflowEvent {
	type: string;
	runId: string;
	nodeId?: string;
	timestamp: string;
	data?: unknown;
}

export function WorkflowsView() {
	const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
	const [runs, setRuns] = useState<WorkflowRun[]>([]);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
	const [events, setEvents] = useState<WorkflowEvent[]>([]);
	const [eventsOpen, setEventsOpen] = useState(false);
	const [stateKey, setStateKey] = useState("");
	const [stateValue, setStateValue] = useState("");
	const [stateEditOpen, setStateEditOpen] = useState(false);
	const [helperId, setHelperId] = useState("");
	const [helperInput, setHelperInput] = useState("{}");
	const [helperResult, setHelperResult] = useState<string | null>(null);
	const [confirmRun, setConfirmRun] = useState<WorkflowDef | null>(null);
	const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
	const [confirmResume, setConfirmResume] = useState<string | null>(null);
	const [validationResult, setValidationResult] =
		useState<ValidationResult | null>(null);
	const [helpers, setHelpers] = useState<HarnessHelper[]>([]);
	const [helperTab, setHelperTab] = useState<"list" | "generate" | "execute">(
		"list",
	);
	const [generatePurpose, setGeneratePurpose] = useState("");
	const [generateFiles, setGenerateFiles] = useState(
		'[{"path":"helper.js","content":"// helper code\\n"}]',
	);
	const [generateTestCmd, setGenerateTestCmd] = useState("");
	const [generateResult, setGenerateResult] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		Promise.all([
			apiFetch<WorkflowDef[]>("/api/state/workflow-definitions").catch(
				() => [] as WorkflowDef[],
			),
			apiFetch<WorkflowRun[]>("/api/state/workflow-runs").catch(
				() => [] as WorkflowRun[],
			),
			apiFetch<{ data?: HarnessHelper[] }>("/api/harness").catch(() => ({
				data: [],
			})),
		])
			.then(([w, r, h]) => {
				setWorkflows(w);
				setRuns(r);
				setHelpers(h.data ?? []);
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
	}, []);

	const handleRun = async (workflow: WorkflowDef) => {
		try {
			await apiFetch("/api/workflows/run", {
				method: "POST",
				body: JSON.stringify({ graph: toRuntimeWorkflowGraph(workflow) }),
			});
			const freshRuns = await apiFetch<WorkflowRun[]>(
				"/api/state/workflow-runs",
			);
			setRuns(freshRuns);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleViewEvents = async (run: WorkflowRun) => {
		try {
			const result = await apiFetch<{ data?: WorkflowEvent[] }>(
				`/api/workflows/runs/${encodeURIComponent(run.id)}/events`,
			);
			setEvents(result.data ?? []);
			setSelectedRun(run);
			setEventsOpen(true);
			setValidationResult(null);
		} catch {
			setEvents([]);
		}
	};

	const handleEditState = async () => {
		if (!selectedRun || !stateKey) return;
		try {
			await apiFetch(
				`/api/workflows/runs/${encodeURIComponent(selectedRun.id)}/state`,
				{
					method: "POST",
					body: JSON.stringify({ key: stateKey, value: stateValue }),
				},
			);
			setStateEditOpen(false);
			setStateKey("");
			setStateValue("");
			const freshRuns = await apiFetch<WorkflowRun[]>(
				"/api/state/workflow-runs",
			);
			setRuns(freshRuns);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleApprove = async (runId: string, nodeId: string) => {
		try {
			await apiFetch(
				`/api/workflows/runs/${encodeURIComponent(runId)}/approve`,
				{
					method: "POST",
					body: JSON.stringify({ nodeId }),
				},
			);
			const freshRuns = await apiFetch<WorkflowRun[]>(
				"/api/state/workflow-runs",
			);
			setRuns(freshRuns);
			if (selectedRun?.id === runId) {
				const result = await apiFetch<{ data?: WorkflowEvent[] }>(
					`/api/workflows/runs/${encodeURIComponent(runId)}/events`,
				);
				setEvents(result.data ?? []);
			}
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleCancel = async (runId: string) => {
		try {
			await apiFetch(
				`/api/workflows/runs/${encodeURIComponent(runId)}/cancel`,
				{ method: "POST" },
			);
			const freshRuns = await apiFetch<WorkflowRun[]>(
				"/api/state/workflow-runs",
			);
			setRuns(freshRuns);
			setConfirmCancel(null);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleResume = async (runId: string) => {
		try {
			await apiFetch(
				`/api/workflows/runs/${encodeURIComponent(runId)}/resume`,
				{ method: "POST" },
			);
			const freshRuns = await apiFetch<WorkflowRun[]>(
				"/api/state/workflow-runs",
			);
			setRuns(freshRuns);
			setConfirmResume(null);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleValidateHelper = async (id: string) => {
		try {
			const result = await apiFetch<{ data?: ValidationResult }>(
				`/api/harness/helpers/${encodeURIComponent(id)}/validate`,
			);
			setValidationResult(result.data ?? null);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleGenerateHelper = async () => {
		try {
			let files: Array<{ path: string; content: string }>;
			try {
				files = JSON.parse(generateFiles);
			} catch {
				files = [{ path: "helper.js", content: "" }];
			}
			const result = await apiFetch<{
				success?: boolean;
				data?: { helper?: { id?: string }; activated?: boolean };
				error?: string;
			}>("/api/harness/generate", {
				method: "POST",
				body: JSON.stringify({
					id: `helper-${Date.now()}`,
					purpose: generatePurpose || "workflow-helper",
					files,
					testCommand: generateTestCmd || undefined,
					activate: true,
				}),
			});
			if (result.success && result.data?.helper?.id) {
				setHelperId(result.data.helper.id);
				setGenerateResult(
					`Helper generated: ${result.data.helper.id} (activated: ${result.data.activated})`,
				);
				const h = await apiFetch<{ data?: HarnessHelper[] }>("/api/harness");
				setHelpers(h.data ?? []);
			} else {
				setGenerateResult(`Generation failed: ${result.error ?? "unknown"}`);
			}
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const handleExecuteHelper = async () => {
		if (!helperId) return;
		try {
			const result = await apiFetch<{
				helperId?: string;
				validation?: { status?: string };
			}>(`/api/harness/helpers/${encodeURIComponent(helperId)}/execute`, {
				method: "POST",
				body: JSON.stringify({ input: JSON.parse(helperInput || "{}") }),
			});
			setHelperResult(
				`Helper executed: ${result.helperId} (validation: ${result.validation?.status ?? "unknown"})`,
			);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	const statusVariant = (status: string) => {
		switch (status) {
			case "completed":
				return "ok";
			case "failed":
				return "warn";
			case "paused":
				return "neutral";
			case "canceled":
				return "warn";
			case "running":
				return "neutral";
			default:
				return "neutral";
		}
	};

	const workflowColumns = [
		{
			key: "id",
			header: "ID",
			cell: (w: WorkflowDef) => (
				<span className="font-mono text-xs">{w.id}</span>
			),
		},
		{
			key: "name",
			header: "Name",
			cell: (w: WorkflowDef) => w.name,
		},
		{
			key: "actions",
			header: "Actions",
			cell: (w: WorkflowDef) => (
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => setConfirmRun(w)}
				>
					Run
				</Button>
			),
		},
	];

	const runColumns = [
		{
			key: "id",
			header: "Run ID",
			cell: (r: WorkflowRun) => (
				<span className="font-mono text-xs">{r.id}</span>
			),
		},
		{
			key: "graphId",
			header: "Workflow",
			cell: (r: WorkflowRun) => r.graphId ?? r.workflowId ?? "—",
		},
		{
			key: "status",
			header: "Status",
			cell: (r: WorkflowRun) => (
				<StatusBadge
					label={r.status}
					variant={statusVariant(r.status) as "ok" | "warn" | "neutral"}
				/>
			),
		},
		{
			key: "actions",
			header: "Actions",
			cell: (r: WorkflowRun) => (
				<div className="flex gap-1 flex-wrap">
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => handleViewEvents(r)}
					>
						Events
					</Button>
					{r.status === "paused" && (
						<>
							<Button
								type="button"
								size="sm"
								variant="default"
								onClick={() => {
									const pendingNode = Object.entries(r.nodeResults ?? {}).find(
										([, v]) =>
											(v as { status?: string })?.status === "pending-approval",
									);
									if (pendingNode) handleApprove(r.id, pendingNode[0]);
								}}
							>
								Approve
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => setConfirmResume(r.id)}
							>
								Resume
							</Button>
						</>
					)}
					{(r.status === "running" || r.status === "paused") && (
						<Button
							type="button"
							size="sm"
							variant="destructive"
							onClick={() => setConfirmCancel(r.id)}
						>
							Cancel
						</Button>
					)}
					{r.status === "failed" && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => setConfirmResume(r.id)}
						>
							Retry
						</Button>
					)}
				</div>
			),
		},
	];

	const helperColumns = [
		{
			key: "id",
			header: "ID",
			cell: (h: HarnessHelper) => (
				<span className="font-mono text-xs">{h.id}</span>
			),
		},
		{
			key: "purpose",
			header: "Purpose",
			cell: (h: HarnessHelper) => (
				<span className="text-xs truncate max-w-[200px] block">
					{h.purpose}
				</span>
			),
		},
		{
			key: "version",
			header: "Version",
			cell: (h: HarnessHelper) => (
				<Badge variant="secondary">{h.version}</Badge>
			),
		},
		{
			key: "status",
			header: "Status",
			cell: (h: HarnessHelper) => (
				<StatusBadge
					label={h.activated ? "active" : "inactive"}
					variant={h.activated ? "ok" : "neutral"}
				/>
			),
		},
		{
			key: "actions",
			header: "Actions",
			cell: (h: HarnessHelper) => (
				<div className="flex gap-1">
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => handleValidateHelper(h.id)}
					>
						Validate
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => {
							setHelperId(h.id);
							setHelperTab("execute");
						}}
					>
						Execute
					</Button>
				</div>
			),
		},
	];

	if (error) {
		return (
			<PageShell>
				<ErrorState message={error} />
			</PageShell>
		);
	}

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<div className="mb-2">
					<h2 className="text-lg font-semibold tracking-tight">Workflows</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Manage workflow definitions, runs, and self-healing helpers.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								Workflow Definitions
								<Badge variant="secondary">{workflows.length}</Badge>
							</CardTitle>
						</CardHeader>
						<CardContent>
							{loading ? (
								<LoadingState message="Loading workflows..." />
							) : workflows.length === 0 ? (
								<EmptyState title="No workflow definitions found." />
							) : (
								<DataTable
									data={workflows}
									columns={workflowColumns}
									emptyMessage="No workflow definitions found."
								/>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								Recent Runs
								<Badge variant="secondary">{runs.length}</Badge>
							</CardTitle>
						</CardHeader>
						<CardContent>
							{loading ? (
								<LoadingState message="Loading runs..." />
							) : runs.length === 0 ? (
								<EmptyState title="No recent workflow runs." />
							) : (
								<DataTable
									data={runs.slice(0, 10)}
									columns={runColumns}
									emptyMessage="No recent workflow runs."
								/>
							)}
						</CardContent>
					</Card>
				</div>

				{/* Events / Run Detail Panel */}
				{eventsOpen && selectedRun && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center justify-between">
								<span>Run Detail — {selectedRun.id}</span>
								<div className="flex gap-2 items-center">
									<StatusBadge
										label={selectedRun.status}
										variant={
											statusVariant(selectedRun.status) as
												| "ok"
												| "warn"
												| "neutral"
										}
									/>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => setEventsOpen(false)}
									>
										Close
									</Button>
								</div>
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{/* Event Timeline */}
							<div>
								<h3 className="text-sm font-medium mb-2">Event Timeline</h3>
								{events.length === 0 ? (
									<EmptyState title="No events recorded for this run." />
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Type</TableHead>
												<TableHead>Node</TableHead>
												<TableHead>Timestamp</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{events.map((ev) => (
												<TableRow
													key={`${ev.type}-${ev.nodeId ?? ""}-${ev.timestamp}`}
												>
													<TableCell>
														<Badge
															variant={
																ev.type.includes("fail")
																	? "destructive"
																	: ev.type.includes("complete")
																		? "default"
																		: "secondary"
															}
															className="font-mono text-xs"
														>
															{ev.type}
														</Badge>
													</TableCell>
													<TableCell className="font-mono text-xs">
														{ev.nodeId ?? "—"}
													</TableCell>
													<TableCell className="text-xs text-muted-foreground">
														{new Date(ev.timestamp).toLocaleTimeString()}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								)}
							</div>

							{/* Pending Approvals */}
							{selectedRun.status === "paused" && (
								<div>
									<h3 className="text-sm font-medium mb-2">
										Pending Approvals
									</h3>
									{Object.entries(selectedRun.nodeResults ?? {})
										.filter(
											([, v]) =>
												(v as { status?: string })?.status ===
												"pending-approval",
										)
										.map(([nodeId]) => (
											<div
												key={nodeId}
												className="flex items-center gap-2 mb-2"
											>
												<span className="font-mono text-xs">{nodeId}</span>
												<Button
													type="button"
													size="sm"
													variant="default"
													onClick={() => handleApprove(selectedRun.id, nodeId)}
												>
													Approve
												</Button>
											</div>
										))}
								</div>
							)}

							{/* Validation Evidence */}
							{validationResult && (
								<div>
									<h3 className="text-sm font-medium mb-2">
										Validation Evidence
									</h3>
									<StatusBadge
										label={validationResult.status}
										variant={
											validationResult.status === "passed" ? "ok" : "warn"
										}
									/>
									<Table className="mt-2">
										<TableHeader>
											<TableRow>
												<TableHead>Check</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Message</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{validationResult.checks.map((check) => (
												<TableRow key={check.name}>
													<TableCell className="font-mono text-xs">
														{check.name}
													</TableCell>
													<TableCell>
														<Badge
															variant={
																check.status === "passed"
																	? "default"
																	: "destructive"
															}
														>
															{check.status}
														</Badge>
													</TableCell>
													<TableCell className="text-xs text-muted-foreground">
														{check.message ?? "—"}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}

							{/* State Editor */}
							<div className="flex flex-col sm:flex-row gap-2 pt-2">
								<Input
									className="h-9 w-full"
									placeholder="State key"
									value={stateKey}
									onChange={(e) => setStateKey(e.target.value)}
								/>
								<Input
									className="h-9 w-full"
									placeholder="State value"
									value={stateValue}
									onChange={(e) => setStateValue(e.target.value)}
								/>
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => setStateEditOpen(true)}
									disabled={!stateKey}
									className="sm:w-auto w-full"
								>
									Edit State
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Helpers Panel */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							Self-Healing Helpers
							<Badge variant="secondary">{helpers.length}</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Tabs */}
						<div className="flex gap-2 border-b pb-2">
							{(["list", "generate", "execute"] as const).map((tab) => (
								<Button
									key={tab}
									type="button"
									variant={helperTab === tab ? "default" : "ghost"}
									size="sm"
									onClick={() => setHelperTab(tab)}
									className="capitalize"
								>
									{tab}
								</Button>
							))}
						</div>

						{helperTab === "list" &&
							(helpers.length === 0 ? (
								<EmptyState title="No helpers registered. Generate one to get started." />
							) : (
								<DataTable
									data={helpers}
									columns={helperColumns}
									emptyMessage="No helpers registered."
								/>
							))}

						{helperTab === "generate" && (
							<div className="space-y-3">
								<div>
									<Label htmlFor="generate-purpose">Purpose</Label>
									<Input
										id="generate-purpose"
										className="h-9"
										value={generatePurpose}
										onChange={(e) => setGeneratePurpose(e.target.value)}
										placeholder="Helper purpose description"
									/>
								</div>
								<div>
									<Label htmlFor="generate-files">Files (JSON)</Label>
									<Textarea
										id="generate-files"
										className="font-mono text-xs"
										value={generateFiles}
										onChange={(e) => setGenerateFiles(e.target.value)}
										rows={4}
										placeholder='[{"path":"helper.js","content":"// code"}]'
									/>
								</div>
								<div>
									<Label htmlFor="generate-test-cmd">
										Test Command (optional)
									</Label>
									<Input
										id="generate-test-cmd"
										className="h-9"
										value={generateTestCmd}
										onChange={(e) => setGenerateTestCmd(e.target.value)}
										placeholder="node helper.js"
									/>
								</div>
								<Button
									type="button"
									onClick={handleGenerateHelper}
									className="sm:w-auto w-full"
								>
									Generate Helper
								</Button>
								{generateResult && (
									<p className="text-xs text-muted-foreground">
										{generateResult}
									</p>
								)}
							</div>
						)}

						{helperTab === "execute" && (
							<div className="space-y-3">
								<div className="flex flex-col sm:flex-row sm:items-center gap-2">
									<Label
										htmlFor="helper-id-input"
										className="text-xs text-muted-foreground"
									>
										Helper ID:
									</Label>
									<Input
										id="helper-id-input"
										className="h-9 w-full"
										value={helperId}
										onChange={(e) => setHelperId(e.target.value)}
										placeholder="helper-id"
									/>
								</div>
								<div className="flex flex-col sm:flex-row sm:items-center gap-2">
									<Label
										htmlFor="helper-input-json"
										className="text-xs text-muted-foreground"
									>
										Input JSON:
									</Label>
									<Input
										id="helper-input-json"
										className="h-9 w-full"
										value={helperInput}
										onChange={(e) => setHelperInput(e.target.value)}
										placeholder='{"key":"value"}'
									/>
								</div>
								<Button
									type="button"
									variant="outline"
									onClick={handleExecuteHelper}
									disabled={!helperId}
									className="sm:w-auto w-full"
								>
									Execute Helper
								</Button>
								{helperResult && (
									<p className="text-xs text-muted-foreground">
										{helperResult}
									</p>
								)}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Confirm Run Dialog */}
				<ConfirmDialog
					open={confirmRun !== null}
					onOpenChange={(open) => {
						if (!open) setConfirmRun(null);
					}}
					title="Run Workflow"
					description={`Execute workflow ${confirmRun?.id ?? ""}?`}
					confirmLabel="Run"
					onConfirm={() => {
						if (confirmRun) {
							handleRun(confirmRun);
							setConfirmRun(null);
						}
					}}
				/>

				{/* Confirm Cancel Dialog */}
				<ConfirmDialog
					open={confirmCancel !== null}
					onOpenChange={(open) => {
						if (!open) setConfirmCancel(null);
					}}
					title="Cancel Workflow Run"
					description={`Cancel run ${confirmCancel ?? ""}? This cannot be undone.`}
					confirmLabel="Cancel Run"
					onConfirm={() => {
						if (confirmCancel) handleCancel(confirmCancel);
					}}
				/>

				{/* Confirm Resume Dialog */}
				<ConfirmDialog
					open={confirmResume !== null}
					onOpenChange={(open) => {
						if (!open) setConfirmResume(null);
					}}
					title="Resume Workflow Run"
					description={`Resume run ${confirmResume ?? ""}?`}
					confirmLabel="Resume"
					onConfirm={() => {
						if (confirmResume) handleResume(confirmResume);
					}}
				/>

				{/* Confirm State Edit Dialog */}
				<ConfirmDialog
					open={stateEditOpen}
					onOpenChange={setStateEditOpen}
					title="Edit Run State"
					description={`Set state key "${stateKey}" to "${stateValue}"?`}
					confirmLabel="Save"
					onConfirm={handleEditState}
				/>
			</div>
		</PageShell>
	);
}
