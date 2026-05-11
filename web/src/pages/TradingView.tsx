import { useCallback, useEffect, useState } from "react";
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

	if (error) return <div className="panel error">{error}</div>;

	return (
		<div className="trading-layout">
			<div className="grid-2" style={{ marginBottom: "20px" }}>
				<div className="panel">
					<div className="panel-title">Mode & Status</div>
					<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
						<div>
							<strong>Mode:</strong> {status?.mode || "Analysis Only"}
						</div>
						<div>
							<strong>Connection:</strong> {status?.connection || "Offline"}
						</div>
						{status?.staleChart && (
							<div style={{ color: "var(--accent)" }}>
								Warning: Stale chart data detected.
							</div>
						)}
					</div>
				</div>
				<div className="panel">
					<div className="panel-title">Active Supervisor Jobs</div>
					{jobs.length === 0 ? (
						<div className="empty-state">No active supervisor jobs.</div>
					) : (
						<table>
							<thead>
								<tr>
									<th>Job ID</th>
									<th>Plan</th>
									<th>Status</th>
								</tr>
							</thead>
							<tbody>
								{jobs.map((j) => (
									<tr key={j.id}>
										<td>{j.id}</td>
										<td>{j.planId}</td>
										<td>{j.status}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</div>

			<div className="panel">
				<div className="panel-title">Trade Plans Workbench</div>
				{plans.length === 0 ? (
					<div className="empty-state">No trade plans found.</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>Symbol</th>
								<th>Side</th>
								<th>Mode</th>
								<th>Status</th>
								<th>Thesis</th>
							</tr>
						</thead>
						<tbody>
							{plans.map((p) => (
								<tr key={p.id}>
									<td>{p.symbol}</td>
									<td>{p.side}</td>
									<td>{p.mode}</td>
									<td>{p.status}</td>
									<td>{p.thesis}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<div className="grid-2">
				<div className="panel">
					<div className="panel-title">Order Tickets & Approvals</div>
					{actionMessage && (
						<div className="inline-status" role="status">
							{actionMessage}
						</div>
					)}
					{tickets.length === 0 ? (
						<div className="empty-state">No pending order tickets.</div>
					) : (
						<table>
							<thead>
								<tr>
									<th>Ticket ID</th>
									<th>Symbol</th>
									<th>Status</th>
									<th>Action</th>
								</tr>
							</thead>
							<tbody>
								{tickets.map((t) => (
									<tr key={t.id}>
										<td>{t.id}</td>
										<td>{t.symbol}</td>
										<td>{t.status}</td>
										<td>
											<button
												type="button"
												className="button button-primary"
												style={{ padding: "4px 8px", marginRight: "4px" }}
												disabled={
													t.status !== "pending" || actingTicketId === t.id
												}
												onClick={() => updateTicket(t, "approve")}
											>
												Approve
											</button>
											<button
												type="button"
												className="button"
												style={{ padding: "4px 8px" }}
												disabled={
													t.status !== "pending" || actingTicketId === t.id
												}
												onClick={() => updateTicket(t, "reject")}
											>
												Reject
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<div
						style={{
							marginTop: "12px",
							fontSize: "0.85rem",
							color: "var(--fg-muted)",
						}}
					>
						Risk Warning: Live order placement requires explicit approval.
					</div>
				</div>

				<div className="panel">
					<div className="panel-title">Journal & Evidence</div>
					{journal.length === 0 ? (
						<div className="empty-state">No journal entries.</div>
					) : (
						<ul style={{ paddingLeft: "20px", fontSize: "0.9rem" }}>
							{journal.map((j) => (
								<li key={j.id} style={{ marginBottom: "8px" }}>
									<span style={{ color: "var(--fg-muted)" }}>
										{new Date(j.timestamp).toLocaleTimeString()}:{" "}
									</span>
									{j.message}
									{j.evidencePath && (
										<a
											href={`/api/evidence/${j.evidencePath}`}
											style={{ marginLeft: "8px", color: "var(--accent)" }}
										>
											[Evidence]
										</a>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
