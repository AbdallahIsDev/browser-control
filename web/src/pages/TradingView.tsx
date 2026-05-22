import { useCallback, useEffect, useState } from "react";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { apiFetch } from "../api";
import type {
	EvidenceRecord,
	JournalEntry,
	OrderTicket,
	SupervisorDecision,
	SupervisorJob,
	TradePlan,
	TradingStatus,
} from "../types";

interface TradingJournalSummary {
	decisions?: SupervisorDecision[];
	evidence?: EvidenceRecord[];
}

function normalizeJournal(payload: JournalEntry[] | TradingJournalSummary) {
	if (Array.isArray(payload)) return payload;
	const decisions = payload.decisions || [];
	const evidence = payload.evidence || [];
	return [
		...decisions.map((decision) => ({
			id: decision.id,
			timestamp: decision.createdAt || decision.id,
			message: `${decision.decision}: ${decision.reason || "Supervisor decision"}`,
		})),
		...evidence.map((record) => ({
			id: record.id,
			timestamp: record.createdAt || record.id,
			message: `${record.type}: ${record.path}`,
			evidencePath: record.path,
		})),
	];
}

function CompactRow({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
			<span className="text-muted-foreground">{label}</span>
			<span className="min-w-0 text-right">{value}</span>
		</div>
	);
}

function friendlyMode(mode?: string) {
	switch (mode) {
		case "analysis_only":
			return "Analysis only";
		case "paper":
			return "Paper trading";
		case "live_assisted":
			return "Live assisted";
		case "live_supervised":
			return "Live supervised";
		default:
			return mode || "Analysis only";
	}
}

function friendlyStatus(status?: string) {
	if (!status) return "Unknown";
	const value = status.replaceAll("_", " ");
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatJournalTime(timestamp: string) {
	const value = new Date(timestamp);
	if (Number.isNaN(value.getTime())) return "Time unknown";
	return value.toLocaleTimeString();
}

function TechnicalIdDetails({
	label,
	value,
}: {
	label: string;
	value?: string;
}) {
	if (!value) return null;
	return (
		<details className="text-xs text-muted-foreground">
			<summary className="cursor-pointer">{label}</summary>
			<code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-[11px]">
				{value}
			</code>
		</details>
	);
}

export function TradingView() {
	const [status, setStatus] = useState<TradingStatus | null>(null);
	const [plans, setPlans] = useState<TradePlan[]>([]);
	const [tickets, setTickets] = useState<OrderTicket[]>([]);
	const [jobs, setJobs] = useState<SupervisorJob[]>([]);
	const [journal, setJournal] = useState<JournalEntry[]>([]);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [actionMessage, setActionMessage] = useState("");
	const [actingTicketId, setActingTicketId] = useState<string | null>(null);

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const [s, p, t, j, jr] = await Promise.all([
				apiFetch<TradingStatus>("/api/trading/status").catch(() => null),
				apiFetch<TradePlan[]>("/api/trading/plans").catch(() => []),
				apiFetch<OrderTicket[]>("/api/trading/tickets").catch(() => []),
				apiFetch<SupervisorJob[]>("/api/trading/jobs").catch(() => []),
				apiFetch<JournalEntry[] | TradingJournalSummary>(
					"/api/trading/journal",
				).catch(() => []),
			]);
			setStatus(s);
			setPlans(p || []);
			setTickets(t || []);
			setJobs(j || []);
			setJournal(normalizeJournal(jr || []));
		} catch (err: unknown) {
			setError(
				`Failed to load trading data: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const updateTicket = async (
		ticket: OrderTicket,
		action: "approve" | "reject",
	) => {
		setActionMessage("");
		setActingTicketId(ticket.id);
		try {
			await apiFetch(
				`/api/trading/tickets/${encodeURIComponent(ticket.id)}/${action}`,
				{
					method: "POST",
					body: JSON.stringify({
						approvedBy: action === "approve" ? "local-user" : undefined,
					}),
				},
			);
			await loadData();
			setActionMessage(
				`Ticket ${ticket.id} ${action === "approve" ? "approved" : "rejected"}.`,
			);
		} catch (err: unknown) {
			setActionMessage(
				`Ticket ${ticket.id} ${action} failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		} finally {
			setActingTicketId(null);
		}
	};

	if (error) {
		return (
			<PageShell>
				<ErrorState message="Failed to load trading data" details={error} />
			</PageShell>
		);
	}

	if (loading) {
		return (
			<PageShell>
				<LoadingState message="Loading TradingView analysis..." />
			</PageShell>
		);
	}

	const visibleJobs = Array.isArray(jobs) ? jobs.slice(0, 12) : [];
	const visiblePlans = Array.isArray(plans) ? plans.slice(0, 12) : [];
	const visibleTickets = Array.isArray(tickets) ? tickets.slice(0, 12) : [];
	const visibleJournal = Array.isArray(journal) ? journal.slice(0, 20) : [];

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<div className="mb-2">
					<h2 className="text-lg font-semibold tracking-tight">
						TradingView analysis package
					</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Review chart analysis, paper trade plans, and approval requests
						without making trading a primary Browser Control workflow.
					</p>
				</div>
				{status && (
					<StatusBadge label={friendlyMode(status.mode)} variant="info" />
				)}
				{status?.staleChart && (
					<Alert>
						<AlertDescription>
							Warning: stale chart data detected.
						</AlertDescription>
					</Alert>
				)}

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Mode & Status</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="space-y-3 text-sm">
								<CompactRow label="Mode" value={friendlyMode(status?.mode)} />
								<CompactRow
									label="Connection"
									value={
										<StatusBadge
											label={status?.connection || "Offline"}
											variant={
												status?.connection === "Connected" ? "ok" : "warn"
											}
										/>
									}
								/>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Active Supervisor Jobs</CardTitle>
						</CardHeader>
						<CardContent>
							{visibleJobs.length === 0 ? (
								<EmptyState title="No active supervisor jobs" />
							) : (
								<div className="space-y-3 md:hidden">
									{visibleJobs.map((job) => (
										<div
											key={job.id}
											className="rounded-[8px] border border-border p-3 text-sm"
										>
											<div className="mb-2 flex items-center justify-between gap-3">
												<span className="min-w-0 font-medium">
													Supervisor check
												</span>
												<Badge variant="secondary">
													{friendlyStatus(job.status)}
												</Badge>
											</div>
											<CompactRow
												label="Plan"
												value={
													job.planId ? "Linked to a trade plan" : "No plan"
												}
											/>
											<TechnicalIdDetails
												label="Technical job ID"
												value={job.id}
											/>
										</div>
									))}
									{jobs.length > 12 && (
										<p className="text-xs text-muted-foreground">
											Showing latest 12 of {jobs.length} supervisor jobs.
										</p>
									)}
								</div>
							)}
							{jobs.length > 0 && (
								<div className="hidden md:block">
									<DataTable
										data={visibleJobs}
										columns={[
											{
												key: "id",
												header: "Check",
												cell: (j) => (
													<div className="space-y-1">
														<div className="font-medium">Supervisor check</div>
														<TechnicalIdDetails
															label="Technical job ID"
															value={j.id}
														/>
													</div>
												),
											},
											{
												key: "planId",
												header: "Plan",
												cell: (j) =>
													j.planId ? (
														<div className="space-y-1">
															<span>Linked to a trade plan</span>
															<TechnicalIdDetails
																label="Plan ID"
																value={j.planId}
															/>
														</div>
													) : (
														"No plan"
													),
											},
											{
												key: "status",
												header: "Status",
												cell: (j) => (
													<Badge variant="secondary">
														{friendlyStatus(j.status)}
													</Badge>
												),
											},
										]}
									/>
									{jobs.length > visibleJobs.length && (
										<p className="mt-2 text-xs text-muted-foreground">
											Showing latest {visibleJobs.length} of {jobs.length}
											supervisor jobs.
										</p>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Trade Plans Workbench</CardTitle>
					</CardHeader>
					<CardContent>
						{plans.length === 0 ? (
							<EmptyState title="No trade plans found" />
						) : (
							<>
								<DataTable
									data={visiblePlans}
									columns={[
										{ key: "symbol", header: "Symbol", cell: (p) => p.symbol },
										{
											key: "side",
											header: "Side",
											cell: (p) => (
												<Badge
													variant={p.side === "buy" ? "default" : "destructive"}
												>
													{friendlyStatus(p.side)}
												</Badge>
											),
										},
										{
											key: "mode",
											header: "Mode",
											cell: (p) => friendlyMode(p.mode),
										},
										{
											key: "status",
											header: "Status",
											cell: (p) => (
												<Badge variant="secondary">
													{friendlyStatus(p.status)}
												</Badge>
											),
										},
										{
											key: "thesis",
											header: "Thesis",
											cell: (p) => (
												<span className="max-w-[300px] truncate block">
													{p.thesis}
												</span>
											),
										},
									]}
								/>
								{plans.length > visiblePlans.length && (
									<p className="mt-2 text-xs text-muted-foreground">
										Showing latest {visiblePlans.length} of {plans.length} trade
										plans.
									</p>
								)}
							</>
						)}
					</CardContent>
				</Card>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Order Tickets & Approvals</CardTitle>
							<CardDescription>
								Risk Warning: Live order placement requires explicit approval.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{actionMessage && (
								<Alert className="mb-4">
									<AlertDescription>{actionMessage}</AlertDescription>
								</Alert>
							)}
							{tickets.length === 0 ? (
								<EmptyState title="No pending order tickets" />
							) : (
								<div className="space-y-3 md:hidden">
									{visibleTickets.map((ticket) => (
										<div
											key={ticket.id}
											className="rounded-[8px] border border-border p-3 text-sm"
										>
											<div className="mb-2 flex items-center justify-between gap-3">
												<span className="min-w-0 font-medium">
													{ticket.symbol || "Order ticket"}
												</span>
												<Badge variant="secondary">
													{friendlyStatus(ticket.status)}
												</Badge>
											</div>
											<div className="mb-3 space-y-2">
												<CompactRow label="Symbol" value={ticket.symbol} />
												<TechnicalIdDetails
													label="Technical ticket ID"
													value={ticket.id}
												/>
											</div>
											<div className="grid grid-cols-2 gap-2">
												<Button
													size="sm"
													onClick={() => updateTicket(ticket, "approve")}
													disabled={
														ticket.status !== "pending" ||
														actingTicketId === ticket.id
													}
												>
													Approve
												</Button>
												<Button
													size="sm"
													variant="outline"
													onClick={() => updateTicket(ticket, "reject")}
													disabled={
														ticket.status !== "pending" ||
														actingTicketId === ticket.id
													}
												>
													Reject
												</Button>
											</div>
										</div>
									))}
									{tickets.length > visibleTickets.length && (
										<p className="text-xs text-muted-foreground">
											Showing latest {visibleTickets.length} of {tickets.length}
											order tickets.
										</p>
									)}
								</div>
							)}
							{tickets.length > 0 && (
								<div className="hidden md:block">
									<DataTable
										data={visibleTickets}
										columns={[
											{
												key: "id",
												header: "Ticket",
												cell: (t) => (
													<div className="space-y-1">
														<div className="font-medium">
															{t.symbol || "Order ticket"}
														</div>
														<TechnicalIdDetails
															label="Technical ticket ID"
															value={t.id}
														/>
													</div>
												),
											},
											{
												key: "symbol",
												header: "Symbol",
												cell: (t) => t.symbol,
											},
											{
												key: "status",
												header: "Status",
												cell: (t) => (
													<Badge variant="secondary">
														{friendlyStatus(t.status)}
													</Badge>
												),
											},
											{
												key: "action",
												header: "Action",
												cell: (t) => (
													<div className="flex flex-col gap-2 sm:flex-row">
														<Button
															size="sm"
															onClick={() => updateTicket(t, "approve")}
															disabled={
																t.status !== "pending" ||
																actingTicketId === t.id
															}
														>
															Approve
														</Button>
														<Button
															size="sm"
															variant="outline"
															onClick={() => updateTicket(t, "reject")}
															disabled={
																t.status !== "pending" ||
																actingTicketId === t.id
															}
														>
															Reject
														</Button>
													</div>
												),
											},
										]}
									/>
									{tickets.length > visibleTickets.length && (
										<p className="mt-2 text-xs text-muted-foreground">
											Showing latest {visibleTickets.length} of {tickets.length}
											order tickets.
										</p>
									)}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Journal & Evidence</CardTitle>
						</CardHeader>
						<CardContent>
							{journal.length === 0 ? (
								<EmptyState title="No journal entries" />
							) : (
								<ul className="space-y-2 text-sm">
									{visibleJournal.map((j) => (
										<li key={j.id} className="flex items-start gap-2">
											<span className="text-muted-foreground shrink-0">
												{formatJournalTime(j.timestamp)}:
											</span>
											<span className="flex-1">{j.message}</span>
											{j.evidencePath && (
												<a
													href={`/api/evidence/${j.evidencePath}`}
													className="text-primary shrink-0"
												>
													[Evidence]
												</a>
											)}
										</li>
									))}
								</ul>
							)}
							{journal.length > visibleJournal.length && (
								<p className="mt-2 text-xs text-muted-foreground">
									Showing latest {visibleJournal.length} of {journal.length}
									journal entries.
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</PageShell>
	);
}
