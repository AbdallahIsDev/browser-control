import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { WorkflowDef, WorkflowRun } from "../types";

export function WorkflowsView() {
	const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
	const [runs, setRuns] = useState<WorkflowRun[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		Promise.all([
			apiFetch<WorkflowDef[]>("/api/state/workflow-definitions").catch(
				() => [],
			),
			apiFetch<WorkflowRun[]>("/api/state/workflow-runs").catch(() => []),
		])
			.then(([w, r]) => {
				setWorkflows(w);
				setRuns(r);
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error)
		return <div className="panel error">Error loading workflows: {error}</div>;

	return (
		<div className="grid-2">
			<div className="panel">
				<div className="panel-title">Workflow Definitions</div>
				{workflows.length === 0 ? (
					<div className="empty-state">No workflow definitions found.</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>ID</th>
								<th>Name</th>
							</tr>
						</thead>
						<tbody>
							{workflows.map((w) => (
								<tr key={w.id}>
									<td>{w.id}</td>
									<td>{w.name}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
			<div className="panel">
				<div className="panel-title">Recent Runs</div>
				{runs.length === 0 ? (
					<div className="empty-state">No recent workflow runs.</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>Run ID</th>
								<th>Workflow</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{runs.slice(0, 10).map((r) => (
								<tr key={r.id}>
									<td>{r.id}</td>
									<td>{r.workflowId}</td>
									<td>{r.status}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
