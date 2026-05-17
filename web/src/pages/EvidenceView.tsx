import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
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
		changeRatio?: number;
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

export function EvidenceView() {
	const [audit, setAudit] = useState<AuditEntry[]>([]);
	const [bundles, setBundles] = useState<DebugBundle[]>([]);
	const [replays, setReplays] = useState<ReplayView[]>([]);
	const [selectedReplay, setSelectedReplay] = useState<ReplayView | null>(null);
	const [executedReplay, setExecutedReplay] = useState<ReplayView | null>(null);
	const [replayExecutionError, setReplayExecutionError] = useState("");
	const [error, setError] = useState("");
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
			}
		};
		load();
	}, []);

	if (error) {
		return (
			<PageShell>
				<ErrorState message={error} />
			</PageShell>
		);
	}

	const filtered = audit
		.filter((e) => !filter.action || e.action === filter.action)
		.filter((e) => !filter.risk || e.risk === filter.risk)
		.slice(0, Number(filter.limit) || 50);

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>Before / After Evidence</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
							<div className="space-y-2">
								<Label htmlFor="before-path">Before screenshot path</Label>
								<Input
									id="before-path"
									value={diffInput.beforePath}
									onChange={(event) =>
										setDiffInput({
											...diffInput,
											beforePath: event.target.value,
										})
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="after-path">After screenshot path</Label>
								<Input
									id="after-path"
									value={diffInput.afterPath}
									onChange={(event) =>
										setDiffInput({
											...diffInput,
											afterPath: event.target.value,
										})
									}
								/>
							</div>
							<Button type="button" onClick={runPixelDiff}>
								Compare
							</Button>
						</div>

						{pixelDiff && (
							<div className="grid gap-3 sm:grid-cols-4">
								<div className="rounded-md border border-[--border-subtle] p-3">
									<div className="text-xs text-[--text-tertiary]">Changed</div>
									<div className="font-mono text-lg">
										{pixelDiff.changedPercent.toFixed(2)}%
									</div>
								</div>
								<div className="rounded-md border border-[--border-subtle] p-3">
									<div className="text-xs text-[--text-tertiary]">Pixels</div>
									<div className="font-mono text-lg">
										{pixelDiff.changedPixelCount ?? 0}/{pixelDiff.totalPixels}
									</div>
								</div>
								<div className="rounded-md border border-[--border-subtle] p-3">
									<div className="text-xs text-[--text-tertiary]">Size</div>
									<div className="font-mono text-lg">
										{pixelDiff.width ?? 0}x{pixelDiff.height ?? 0}
									</div>
								</div>
								<div className="rounded-md border border-[--border-subtle] p-3">
									<div className="text-xs text-[--text-tertiary]">Artifact</div>
									<div className="truncate font-mono text-xs">
										{pixelDiff.diffPath}
									</div>
								</div>
							</div>
						)}

						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="dom-before">Before DOM nodes JSON</Label>
								<Input
									id="dom-before"
									value={domInput.before}
									onChange={(event) =>
										setDomInput({ ...domInput, before: event.target.value })
									}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="dom-after">After DOM nodes JSON</Label>
								<Input
									id="dom-after"
									value={domInput.after}
									onChange={(event) =>
										setDomInput({ ...domInput, after: event.target.value })
									}
								/>
							</div>
						</div>
						<Button type="button" variant="outline" onClick={runDomDiff}>
							Diff DOM
						</Button>

						{domDiff && (
							<div className="rounded-md border border-[--border-subtle] p-3">
								<div className="flex flex-wrap gap-4 text-sm">
									<span>Added: {domDiff.elementsAdded}</span>
									<span>Removed: {domDiff.elementsRemoved}</span>
									<span>Changed: {domDiff.elementsChanged}</span>
								</div>
								{domDiff.changedNodes.length > 0 && (
									<div className="mt-3 overflow-x-auto">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Selector</TableHead>
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
														<TableCell>{node.oldText}</TableCell>
														<TableCell>{node.newText}</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								)}
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Audit Log</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col sm:flex-row sm:items-center gap-3">
							<div className="flex flex-col sm:flex-row sm:items-center gap-2">
								<Label
									htmlFor="audit-action-filter"
									className="text-xs text-[--text-tertiary]"
								>
									Action:
								</Label>
								<Input
									id="audit-action-filter"
									className="h-9 w-full sm:w-40 text-sm"
									placeholder="Filter by action"
									value={filter.action}
									onChange={(e) =>
										setFilter({ ...filter, action: e.target.value })
									}
								/>
							</div>
							<div className="flex flex-col sm:flex-row sm:items-center gap-2">
								<Label
									htmlFor="audit-risk-filter"
									className="text-xs text-[--text-tertiary]"
								>
									Risk:
								</Label>
								<Select
									value={filter.risk || "all"}
									onValueChange={(value) =>
										setFilter({
											...filter,
											risk: value === "all" ? "" : (value ?? ""),
										})
									}
								>
									<SelectTrigger
										id="audit-risk-filter"
										className="h-9 w-full sm:w-36"
									>
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
							<span className="text-xs text-[--text-tertiary]">
								{filtered.length} of {audit.length}
							</span>
						</div>

						{filtered.length === 0 ? (
							<EmptyState title="No matching audit entries." />
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Time</TableHead>
											<TableHead>Action</TableHead>
											<TableHead>Decision</TableHead>
											<TableHead>Risk</TableHead>
											<TableHead>Details</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{filtered.map((e) => (
											<TableRow key={e.id}>
												<TableCell className="text-xs font-mono">
													{e.timestamp?.slice(11, 19)}
												</TableCell>
												<TableCell>{e.action}</TableCell>
												<TableCell>
													<StatusBadge
														label={e.policyDecision || "-"}
														variant={
															e.policyDecision === "deny" ? "warn" : "ok"
														}
													/>
												</TableCell>
												<TableCell>{e.risk}</TableCell>
												<TableCell className="max-w-[200px] truncate">
													{e.details}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Debug Bundles</CardTitle>
					</CardHeader>
					<CardContent>
						{bundles.length === 0 ? (
							<EmptyState title="No debug bundles." />
						) : (
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Bundle ID</TableHead>
											<TableHead>Task</TableHead>
											<TableHead>Assembled</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{bundles.slice(0, 20).map((b) => (
											<TableRow key={b.bundleId}>
												<TableCell className="font-mono text-xs">
													{b.bundleId.slice(0, 12)}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{b.taskId.slice(0, 12)}
												</TableCell>
												<TableCell className="text-xs">
													{b.assembledAt?.slice(0, 19)}
												</TableCell>
												<TableCell>
													<StatusBadge
														label={b.partial ? "Partial" : "Complete"}
														variant={b.partial ? "warn" : "ok"}
													/>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Replay Debugger</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{replays.length === 0 ? (
							<EmptyState title="No workflow replays." />
						) : (
							<>
								<div className="flex flex-wrap gap-2">
									{replays.map((r) => (
										<Button
											key={r.runId}
											type="button"
											size="sm"
											variant={
												selectedReplay?.runId === r.runId
													? "default"
													: "outline"
											}
											onClick={() => setSelectedReplay(r)}
											className="sm:w-auto w-full"
										>
											{r.runId.slice(0, 8)} ({r.status})
										</Button>
									))}
								</div>
								{selectedReplay && (
									<div className="rounded-md border border-[--border-subtle] bg-[--bg-surface] p-4 space-y-3">
										<div className="flex flex-wrap items-center gap-4 text-sm">
											<span>
												Duration:{" "}
												{(selectedReplay.totalDurationMs / 1000).toFixed(1)}s
											</span>
											<span>Steps: {selectedReplay.steps.length}</span>
											<StatusBadge
												label={selectedReplay.status}
												variant={
													selectedReplay.status === "completed" ? "ok" : "warn"
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
											<div className="rounded-md border border-[--border-subtle] p-3 text-sm">
												Executed replay: {executedReplay.status}; steps{" "}
												{executedReplay.steps.length}
											</div>
										)}
										<div className="overflow-x-auto">
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>#</TableHead>
														<TableHead>Node</TableHead>
														<TableHead>Kind</TableHead>
														<TableHead>Input</TableHead>
														<TableHead>Policy</TableHead>
														<TableHead>Retries</TableHead>
														<TableHead>Error</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{selectedReplay.steps.map((s) => (
														<TableRow key={`${s.nodeId}-${s.index}`}>
															<TableCell>{s.index}</TableCell>
															<TableCell className="font-mono text-xs">
																{s.nodeId.slice(0, 8)}
															</TableCell>
															<TableCell>{s.kind}</TableCell>
															<TableCell className="max-w-[150px] truncate text-xs">
																{JSON.stringify(s.input).slice(0, 60)}
															</TableCell>
															<TableCell>{s.policyDecision || "-"}</TableCell>
															<TableCell>{s.retryCount}</TableCell>
															<TableCell className="text-[--status-warn] text-xs">
																{s.error?.slice(0, 40)}
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</div>
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</PageShell>
	);
}
