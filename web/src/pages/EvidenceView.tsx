import { useEffect, useState } from "react";
import { apiFetch } from "../api";

interface AuditEntry { id: string; action: string; sessionId?: string; policyDecision?: string; risk?: string; details?: string; timestamp: string; }
interface ReplayStep { index: number; nodeId: string; kind: string; input: Record<string, unknown>; error?: string; policyDecision?: string; retryCount: number; durationMs: number; startedAt: string; }
interface ReplayView { runId: string; status: string; steps: ReplayStep[]; totalDurationMs: number; startedAt: string; completedAt?: string; }
interface DebugBundle { bundleId: string; taskId: string; assembledAt: string; partial: boolean; }

export function EvidenceView() {
	const [audit, setAudit] = useState<AuditEntry[]>([]);
	const [bundles, setBundles] = useState<DebugBundle[]>([]);
	const [replays, setReplays] = useState<ReplayView[]>([]);
	const [selectedReplay, setSelectedReplay] = useState<ReplayView | null>(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState({ action: "", risk: "", limit: "50" });

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
			} catch (err) { setError(String(err)); }
		};
		load();
	}, []);

	if (error) return <div className="panel error">{error}</div>;

	const filtered = audit
		.filter(e => !filter.action || e.action === filter.action)
		.filter(e => !filter.risk || e.risk === filter.risk)
		.slice(0, Number(filter.limit) || 50);

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div className="panel">
				<div className="panel-title">Audit Log</div>
				<div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
					<input placeholder="Action filter" value={filter.action} onChange={e => setFilter({ ...filter, action: e.target.value })} style={{ width: "140px" }} />
					<select value={filter.risk} onChange={e => setFilter({ ...filter, risk: e.target.value })} style={{ padding: "6px", borderRadius: "4px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
						<option value="">All risk</option>
						<option value="low">Low</option>
						<option value="moderate">Moderate</option>
						<option value="high">High</option>
						<option value="critical">Critical</option>
					</select>
					<span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", alignSelf: "center" }}>{filtered.length} of {audit.length}</span>
				</div>
				{filtered.length === 0 ? <div style={{ padding: "12px", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>No matching audit entries.</div> : (
					<table style={{ fontSize: "0.75rem" }}>
						<thead><tr><th>Time</th><th>Action</th><th>Decision</th><th>Risk</th><th>Details</th></tr></thead>
						<tbody>
							{filtered.map(e => (
								<tr key={e.id}>
									<td style={{ fontSize: "0.7rem" }}>{e.timestamp?.slice(11, 19)}</td>
									<td>{e.action}</td>
									<td><span className={e.policyDecision === "deny" ? "status-warn" : "status-ok"}>{e.policyDecision}</span></td>
									<td>{e.risk}</td>
									<td style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }}>{e.details}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<div className="panel">
				<div className="panel-title">Debug Bundles</div>
				{bundles.length === 0 ? <div style={{ padding: "12px", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>No debug bundles.</div> : (
					<table style={{ fontSize: "0.8rem" }}>
						<thead><tr><th>Bundle ID</th><th>Task</th><th>Assembled</th><th>Status</th></tr></thead>
						<tbody>
							{bundles.slice(0, 20).map(b => (
								<tr key={b.bundleId}>
									<td>{b.bundleId.slice(0, 12)}</td>
									<td>{b.taskId.slice(0, 12)}</td>
									<td>{b.assembledAt?.slice(0, 19)}</td>
									<td>{b.partial ? "Partial" : "Complete"}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<div className="panel">
				<div className="panel-title">Replay Debugger</div>
				{replays.length === 0 ? <div style={{ padding: "12px", fontSize: "0.8rem", color: "var(--text-tertiary)" }}>No workflow replays.</div> : (
					<>
						<div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
							{replays.map(r => (
								<button key={r.runId} type="button" className={`button ${selectedReplay?.runId === r.runId ? "button-primary" : ""}`}
									style={{ fontSize: "0.75rem", padding: "4px 10px", height: "auto" }}
									onClick={() => setSelectedReplay(r)}>
									{r.runId.slice(0, 8)} ({r.status})
								</button>
							))}
						</div>
						{selectedReplay && (
							<div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "12px" }}>
								<div style={{ marginBottom: "8px", fontSize: "0.8rem" }}>
									Duration: {(selectedReplay.totalDurationMs / 1000).toFixed(1)}s · Steps: {selectedReplay.steps.length} · Status: <span className={selectedReplay.status === "completed" ? "status-ok" : "status-warn"}>{selectedReplay.status}</span>
								</div>
								<table style={{ fontSize: "0.75rem" }}>
									<thead><tr><th>#</th><th>Node</th><th>Kind</th><th>Input</th><th>Policy</th><th>Retries</th><th>Error</th></tr></thead>
									<tbody>
										{selectedReplay.steps.map(s => (
											<tr key={s.nodeId}>
												<td>{s.index}</td>
												<td>{s.nodeId.slice(0, 8)}</td>
												<td>{s.kind}</td>
												<td style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis" }}>{JSON.stringify(s.input).slice(0, 60)}</td>
												<td>{s.policyDecision || "-"}</td>
												<td>{s.retryCount}</td>
												<td style={{ color: "var(--status-warn)" }}>{s.error?.slice(0, 40)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</>
				)}
			</div>

			<div className="panel">
				<div className="panel-title">Before / After Snapshots</div>
				<p style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>
					Run a workflow with screenshots enabled to see before/after comparisons with pixel and DOM diffs.
				</p>
			</div>
		</div>
	);
}
