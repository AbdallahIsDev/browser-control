import { useCallback, useEffect, useState } from "react";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
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

export function TradingView() {
	const [status, setStatus] = useState<TradingStatus | null>(null);
	const [plans, setPlans] = useState<TradePlan[]>([]);
	const [tickets, setTickets] = useState<OrderTicket[]>([]);
	const [jobs, setJobs] = useState<SupervisorJob[]>([]);
	const [journal, setJournal] = useState<JournalEntry[]>([]);
	const [error, setError] = useState("");
	const [actionMessage, setActionMessage] = useState("");
	const [actingTicketId, setActingTicketId] = useState<string | null>(null);

	const loadData = useCallback(async () => {
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

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<div className="mb-2">
					<h2 className="text-lg font-semibold tracking-tight">Trading</h2>
					<p className="text-sm text-muted-foreground mt-1">
						Monitor trade plans, order tickets, and supervisor jobs.
					</p>
				</div>
				{status && (
					<StatusBadge label={status.mode || "Analysis Only"} variant="info" />
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
								<CompactRow
									label="Mode"
									value={status?.mode || "Analysis Only"}
								/>
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
							{jobs.length === 0 ? (
								<EmptyState title="No active supervisor jobs" />
							) : (
								<div className="space-y-3 md:hidden">
									{jobs.slice(0, 12).map((job) => (
										<div
											key={job.id}
											className="rounded-[8px] border border-border p-3 text-sm"
										>
											<div className="mb-2 flex items-center justify-between gap-3">
												<span className="min-w-0 truncate font-mono text-xs">
													{job.id}
												</span>
												<Badge variant="secondary">{job.status}</Badge>
											</div>
											<CompactRow
												label="Plan"
												value={
													<span className="font-mono text-xs">
														{job.planId || "No plan"}
													</span>
												}
											/>
										</div>
									))}
								</div>
							)}
							{jobs.length > 0 && (
								<div className="hidden md:block">
									<DataTable
										data={jobs}
										columns={[
											{
												key: "id",
												header: "Job ID",
												cell: (j) => (
													<span className="inline-block max-w-[240px] truncate font-mono text-xs">
														{j.id}
													</span>
												),
											},
											{
												key: "planId",
												header: "Plan",
												cell: (j) => j.planId,
											},
											{
												key: "status",
												header: "Status",
												cell: (j) => (
													<Badge variant="secondary">{j.status}</Badge>
												),
											},
										]}
									/>
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
							<DataTable
								data={plans}
								columns={[
									{ key: "symbol", header: "Symbol", cell: (p) => p.symbol },
									{
										key: "side",
										header: "Side",
										cell: (p) => (
											<Badge
												variant={p.side === "buy" ? "default" : "destructive"}
											>
												{p.side}
											</Badge>
										),
									},
									{ key: "mode", header: "Mode", cell: (p) => p.mode },
									{
										key: "status",
										header: "Status",
										cell: (p) => <Badge variant="secondary">{p.status}</Badge>,
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
									{tickets.map((ticket) => (
										<div
											key={ticket.id}
											className="rounded-[8px] border border-border p-3 text-sm"
										>
											<div className="mb-2 flex items-center justify-between gap-3">
												<span className="min-w-0 truncate font-mono text-xs">
													{ticket.id}
												</span>
												<Badge variant="secondary">{ticket.status}</Badge>
											</div>
											<div className="mb-3 space-y-2">
												<CompactRow label="Symbol" value={ticket.symbol} />
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
								</div>
							)}
							{tickets.length > 0 && (
								<div className="hidden md:block">
									<DataTable
										data={tickets}
										columns={[
											{
												key: "id",
												header: "Ticket ID",
												cell: (t) => (
													<span className="inline-block max-w-[240px] truncate font-mono text-xs">
														{t.id}
													</span>
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
													<Badge variant="secondary">{t.status}</Badge>
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
									{journal.map((j) => (
										<li key={j.id} className="flex items-start gap-2">
											<span className="text-muted-foreground shrink-0">
												{new Date(j.timestamp).toLocaleTimeString()}:
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
						</CardContent>
					</Card>
				</div>
			</div>
		</PageShell>
	);
}
