import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";

interface AuditEntry {
	id: string;
	action: string;
	sessionId?: string;
	policyDecision?: string;
	risk?: string;
	details?: string;
	timestamp: string;
}

interface ReplayStep {
	index: number;
	nodeId: string;
	kind: string;
	input: Record<string, unknown>;
	error?: string;
	policyDecision?: string;
	retryCount: number;
	durationMs: number;
	startedAt: string;
}

interface ReplayView {
	runId: string;
	status: string;
	steps: ReplayStep[];
	totalDurationMs: number;
	startedAt: string;
	completedAt?: string;
}

interface DebugBundle {
	bundleId: string;
	taskId: string;
	assembledAt: string;
	partial: boolean;
}

interface PixelDiffResponse {
	success: boolean;
	data?: {
		diffPath?: string;
		width?: number;
		height?: number;
		changedPixelCount?: number;
		changedPercent: number;
		totalPixels: number;
	};
	error?: string;
}

interface DomDiffResult {
	elementsAdded: number;
	elementsRemoved: number;
	elementsChanged: number;
	changedNodes: Array<{
		selector: string;
		oldText?: string;
		newText?: string;
	}>;
}

const EVIDENCE_EXPLANATION =
	"Review screenshots, page changes, policy decisions, and audit events produced while Browser Control works.";
const PLAIN_LANGUAGE_SUMMARY_LABEL = "plain-language summary";

function formatTime(value?: string): string {
	if (!value) return "Unknown time";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown time";
	return date.toLocaleString();
}

function decisionVariant(decision?: string): "ok" | "warn" | "neutral" {
	if (decision === "deny" || decision === "confirm") return "warn";
	if (decision === "allow" || decision === "audit") return "ok";
	return "neutral";
}

function riskVariant(risk?: string): "ok" | "warn" | "neutral" {
	if (risk === "high" || risk === "critical") return "warn";
	if (risk === "low" || risk === "moderate") return "ok";
	return "neutral";
}

function summarizeAudit(entry: AuditEntry): string {
	const decision = entry.policyDecision || "recorded";
	const risk = entry.risk ? `${entry.risk} risk` : "unknown risk";
	return `Browser Control ${decision} ${entry.action} with ${risk}.`;
}

function RawDetails({
	label = "Raw technical details",
	value,
}: {
	label?: string;
	value: unknown;
}) {
	return (
		<details className="rounded-md border border-border bg-muted/20 p-3 text-xs">
			<summary className="cursor-pointer text-muted-foreground">
				{label}
			</summary>
			<pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
				{JSON.stringify(value, null, 2)}
			</pre>
		</details>
	);
}

export function EvidenceView() {
	const [audit, setAudit] = useState<AuditEntry[]>([]);
	const [bundles, setBundles] = useState<DebugBundle[]>([]);
	const [replays, setReplays] = useState<ReplayView[]>([]);
	const [selectedReplay, setSelectedReplay] = useState<ReplayView | null>(null);
	const [executedReplay, setExecutedReplay] = useState<ReplayView | null>(null);
	const [replayExecutionError, setReplayExecutionError] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState({ action: "", risk: "", limit: "12" });
	const [diffInput, setDiffInput] = useState({ beforePath: "", afterPath: "" });
	const [pixelDiff, setPixelDiff] = useState<PixelDiffResponse["data"] | null>(
		null,
	);
	const [domInput, setDomInput] = useState({
		before: '[{"selector":"#result","text":"Old"}]',
		after: '[{"selector":"#result","text":"New"}]',
	});
	const [domDiff, setDomDiff] = useState<DomDiffResult | null>(null);

	const runPixelDiff = async () => {
		const result = await apiFetch<PixelDiffResponse>("/api/debug/visual-diff", {
			method: "POST",
			body: JSON.stringify(diffInput),
		});
		if (!result.success) throw new Error(result.error || "Visual diff failed");
		setPixelDiff(result.data ?? null);
	};

	const runDomDiff = async () => {
		setDomDiff(
			await apiFetch<DomDiffResult>("/api/debug/dom-diff", {
				method: "POST",
				body: JSON.stringify({
					beforeNodes: JSON.parse(domInput.before),
					afterNodes: JSON.parse(domInput.after),
				}),
			}),
		);
	};

	const executeReplay = async (runId: string) => {
		setReplayExecutionError("");
		const result = await apiFetch<{
			success: boolean;
			data?: ReplayView;
			error?: string;
		}>(`/api/debug/replays/${encodeURIComponent(runId)}/execute`, {
			method: "POST",
		});
		if (!result.success || !result.data) {
			setReplayExecutionError(result.error || "Replay execution failed");
			return;
		}
		setExecutedReplay(result.data);
		setSelectedReplay(result.data);
	};

	useEffect(() => {
		const load = async () => {
			setLoading(true);
			try {
				const [a, b, r] = await Promise.all([
					apiFetch<AuditEntry[]>("/api/audit").catch(() => []),
					apiFetch<DebugBundle[]>("/api/debug/bundles").catch(() => []),
					apiFetch<ReplayView[]>("/api/debug/replays").catch(() => []),
				]);
				setAudit(a ?? []);
				setBundles(b ?? []);
				setReplays(r ?? []);
			} catch (err: unknown) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setLoading(false);
			}
		};
		load();
	}, []);

	if (loading) {
		return (
			<PageShell>
				<LoadingState message="Loading evidence..." />
			</PageShell>
		);
	}

	if (error) {
		return (
			<PageShell>
				<ErrorState
					message="Evidence could not load"
					details="Browser Control could not read evidence stores. Runtime actions can continue; evidence will appear after the store reconnects."
				/>
			</PageShell>
		);
	}

	const filtered = audit
		.filter((entry) => !filter.action || entry.action === filter.action)
		.filter((entry) => !filter.risk || entry.risk === filter.risk)
		.slice(0, Number(filter.limit) || 50);

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<div className="space-y-2">
					<h2 className="text-2xl font-semibold tracking-tight">Evidence</h2>
					<p className="max-w-3xl text-sm text-muted-foreground">
						{EVIDENCE_EXPLANATION}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Visual comparison</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-muted-foreground">
							Compare two screenshots to see what changed on the page.
						</p>
						<div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
							<div className="space-y-2">
								<Label htmlFor="before-path">Before screenshot</Label>
								<Input
									id="before-path"
									value={diffInput.beforePath}
									onChange={(event) =>
										setDiffInput({
											...diffInput,
											beforePath: event.target.value,
										})
									}
									placeholder="Path to earlier screenshot"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="after-path">After screenshot</Label>
								<Input
									id="after-path"
									value={diffInput.afterPath}
									onChange={(event) =>
										setDiffInput({
											...diffInput,
											afterPath: event.target.value,
										})
									}
									placeholder="Path to later screenshot"
								/>
							</div>
							<Button type="button" onClick={runPixelDiff}>
								Compare
							</Button>
						</div>

						{pixelDiff ? (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
								<div className="rounded-md border border-border p-3">
									<p className="text-xs text-muted-foreground">Page changed</p>
									<p className="text-lg font-semibold">
										{pixelDiff.changedPercent.toFixed(2)}%
									</p>
								</div>
								<div className="rounded-md border border-border p-3">
									<p className="text-xs text-muted-foreground">
										Changed pixels
									</p>
									<p className="text-lg font-semibold">
										{pixelDiff.changedPixelCount ?? 0}/{pixelDiff.totalPixels}
									</p>
								</div>
								<div className="rounded-md border border-border p-3">
									<p className="text-xs text-muted-foreground">Image size</p>
									<p className="text-lg font-semibold">
										{pixelDiff.width ?? 0} x {pixelDiff.height ?? 0}
									</p>
								</div>
								<div className="rounded-md border border-border p-3">
									<p className="text-xs text-muted-foreground">Diff file</p>
									<p className="break-all font-mono text-xs">
										{pixelDiff.diffPath || "Not saved"}
									</p>
								</div>
							</div>
						) : (
							<EmptyState
								title="No visual comparison yet"
								description="Add before and after screenshot paths to generate a visual diff."
							/>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Page changes</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-sm text-muted-foreground">
							Summarize page structure changes. Raw DOM JSON stays hidden until
							opened.
						</p>
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="dom-before">Before page nodes</Label>
								<Input
									id="dom-before"
									value={domInput.before}
									onChange={(event) =>
										setDomInput({ ...domInput, before: event.target.value })
									}
									placeholder="Paste before nodes JSON"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="dom-after">After page nodes</Label>
								<Input
									id="dom-after"
									value={domInput.after}
									onChange={(event) =>
										setDomInput({ ...domInput, after: event.target.value })
									}
									placeholder="Paste after nodes JSON"
								/>
							</div>
						</div>
						<Button type="button" variant="outline" onClick={runDomDiff}>
							Summarize changes
						</Button>

						{domDiff ? (
							<div className="space-y-3">
								<div className="grid gap-3 sm:grid-cols-3">
									<div className="rounded-md border border-border p-3">
										<p className="text-xs text-muted-foreground">Added</p>
										<p className="text-lg font-semibold">
											{domDiff.elementsAdded}
										</p>
									</div>
									<div className="rounded-md border border-border p-3">
										<p className="text-xs text-muted-foreground">Removed</p>
										<p className="text-lg font-semibold">
											{domDiff.elementsRemoved}
										</p>
									</div>
									<div className="rounded-md border border-border p-3">
										<p className="text-xs text-muted-foreground">Changed</p>
										<p className="text-lg font-semibold">
											{domDiff.elementsChanged}
										</p>
									</div>
								</div>
								{domDiff.changedNodes.length === 0 ? (
									<EmptyState title="No changed text nodes" />
								) : (
									<div className="overflow-x-auto">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Page area</TableHead>
													<TableHead>Before</TableHead>
													<TableHead>After</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{domDiff.changedNodes.map((node) => (
													<TableRow key={node.selector}>
														<TableCell className="font-mono text-xs">
															{node.selector}
														</TableCell>
														<TableCell>{node.oldText || "-"}</TableCell>
														<TableCell>{node.newText || "-"}</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								)}
								<RawDetails label="Raw DOM diff" value={domDiff} />
							</div>
						) : (
							<EmptyState
								title="No page change summary yet"
								description="Run a page-change summary to see added, removed, and changed content."
							/>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Policy and safety decisions</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
							<div className="space-y-2">
								<Label htmlFor="audit-action-filter">Action</Label>
								<Input
									id="audit-action-filter"
									placeholder="Filter by action"
									value={filter.action}
									onChange={(event) =>
										setFilter({ ...filter, action: event.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="audit-risk-filter">Risk</Label>
								<Select
									value={filter.risk || "all"}
									onValueChange={(value) =>
										setFilter({
											...filter,
											risk: value === "all" ? "" : (value ?? ""),
										})
									}
								>
									<SelectTrigger id="audit-risk-filter">
										<SelectValue placeholder="All risk" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All risk</SelectItem>
										<SelectItem value="low">Low</SelectItem>
										<SelectItem value="moderate">Moderate</SelectItem>
										<SelectItem value="high">High</SelectItem>
										<SelectItem value="critical">Critical</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<p className="text-xs text-muted-foreground">
								{filtered.length} of {audit.length}
							</p>
						</div>

						{filtered.length === 0 ? (
							<EmptyState
								title="No policy decisions yet"
								description="Policy approvals, denials, and audited actions appear here after Browser Control works."
							/>
						) : (
							<div className="space-y-3">
								{filtered.map((entry) => (
									<div
										key={entry.id}
										className="rounded-md border border-border p-4"
									>
										<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
											<div className="min-w-0 space-y-1">
												<p className="font-medium">{entry.action}</p>
												<p className="text-sm text-muted-foreground">
													{summarizeAudit(entry)} This is the plain-language
													summary ({PLAIN_LANGUAGE_SUMMARY_LABEL}).
												</p>
												<p className="text-xs text-muted-foreground">
													{formatTime(entry.timestamp)}
												</p>
											</div>
											<div className="flex flex-wrap gap-2">
												<StatusBadge
													label={entry.policyDecision || "recorded"}
													variant={decisionVariant(entry.policyDecision)}
												/>
												<StatusBadge
													label={entry.risk || "unknown risk"}
													variant={riskVariant(entry.risk)}
												/>
											</div>
										</div>
										{entry.details && (
											<p className="mt-3 text-sm text-muted-foreground">
												{entry.details}
											</p>
										)}
										<div className="mt-3">
											<RawDetails value={entry} />
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Technical details</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<h3 className="text-sm font-medium">Debug bundles</h3>
							{bundles.length === 0 ? (
								<EmptyState
									title="No debug bundles"
									description="Failure bundles appear here when Browser Control collects logs, screenshots, and receipts."
								/>
							) : (
								<div className="mt-3 overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Bundle</TableHead>
												<TableHead>Task</TableHead>
												<TableHead>Created</TableHead>
												<TableHead>Status</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{bundles.slice(0, 20).map((bundle) => (
												<TableRow key={bundle.bundleId}>
													<TableCell className="font-mono text-xs">
														{bundle.bundleId.slice(0, 12)}
													</TableCell>
													<TableCell className="font-mono text-xs">
														{bundle.taskId.slice(0, 12)}
													</TableCell>
													<TableCell className="text-xs">
														{formatTime(bundle.assembledAt)}
													</TableCell>
													<TableCell>
														<StatusBadge
															label={bundle.partial ? "Partial" : "Complete"}
															variant={bundle.partial ? "warn" : "ok"}
														/>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</div>

						<div>
							<h3 className="text-sm font-medium">Replay debugger</h3>
							{replays.length === 0 ? (
								<EmptyState
									title="No workflow replays"
									description="Recorded workflow runs appear here with step-by-step evidence."
								/>
							) : (
								<div className="mt-3 space-y-3">
									<div className="flex flex-wrap gap-2">
										{replays.map((replay) => (
											<Button
												key={replay.runId}
												type="button"
												size="sm"
												variant={
													selectedReplay?.runId === replay.runId
														? "default"
														: "outline"
												}
												onClick={() => setSelectedReplay(replay)}
											>
												{replay.runId.slice(0, 8)} ({replay.status})
											</Button>
										))}
									</div>
									{selectedReplay && (
										<div className="rounded-md border border-border p-4 space-y-3">
											<div className="flex flex-wrap items-center gap-3 text-sm">
												<span>
													Duration:{" "}
													{(selectedReplay.totalDurationMs / 1000).toFixed(1)}s
												</span>
												<span>Steps: {selectedReplay.steps.length}</span>
												<StatusBadge
													label={selectedReplay.status}
													variant={
														selectedReplay.status === "completed"
															? "ok"
															: "warn"
													}
												/>
												{selectedReplay.status === "recorded" && (
													<Button
														type="button"
														size="sm"
														variant="outline"
														onClick={() => executeReplay(selectedReplay.runId)}
													>
														Execute Replay
													</Button>
												)}
											</div>
											{replayExecutionError && (
												<ErrorState message={replayExecutionError} />
											)}
											{executedReplay?.runId === selectedReplay.runId && (
												<p className="rounded-md border border-border p-3 text-sm">
													Executed replay: {executedReplay.status}; steps{" "}
													{executedReplay.steps.length}
												</p>
											)}
											<div className="overflow-x-auto">
												<Table>
													<TableHeader>
														<TableRow>
															<TableHead>#</TableHead>
															<TableHead>Step</TableHead>
															<TableHead>Type</TableHead>
															<TableHead>Policy</TableHead>
															<TableHead>Retries</TableHead>
															<TableHead>Error</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{selectedReplay.steps.map((step) => (
															<TableRow key={`${step.nodeId}-${step.index}`}>
																<TableCell>{step.index}</TableCell>
																<TableCell className="font-mono text-xs">
																	{step.nodeId.slice(0, 8)}
																</TableCell>
																<TableCell>{step.kind}</TableCell>
																<TableCell>
																	{step.policyDecision || "-"}
																</TableCell>
																<TableCell>{step.retryCount}</TableCell>
																<TableCell className="text-xs text-rose-400">
																	{step.error?.slice(0, 60)}
																</TableCell>
															</TableRow>
														))}
													</TableBody>
												</Table>
											</div>
											<RawDetails
												label="Raw replay details"
												value={selectedReplay}
											/>
										</div>
									)}
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			</div>
		</PageShell>
	);
}
