import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { Task } from "../types";

export function TasksView() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		apiFetch<Task[]>("/api/tasks")
			.then(setTasks)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error)
		return <div className="panel error">Error loading tasks: {error}</div>;

	return (
		<div className="panel">
			<div className="panel-title">Tasks</div>
			{tasks.length === 0 ? (
				<div className="empty-state">No recent tasks.</div>
			) : (
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>Prompt</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{tasks.map((t) => (
							<tr key={t.id}>
								<td>{t.id}</td>
								<td>{t.prompt}</td>
								<td>{t.status}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
