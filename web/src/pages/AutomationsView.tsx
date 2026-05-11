import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { Automation } from "../types";

export function AutomationsView() {
	const [automations, setAutomations] = useState<Automation[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		apiFetch<Automation[]>("/api/saved-automations")
			.then(setAutomations)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error)
		return (
			<div className="panel error">Error loading automations: {error}</div>
		);

	return (
		<div className="panel">
			<div className="panel-title">Saved Automations</div>
			{automations.length === 0 ? (
				<div className="empty-state">No automations saved yet.</div>
			) : (
				<table>
					<thead>
						<tr>
							<th>Name</th>
							<th>Prompt</th>
						</tr>
					</thead>
					<tbody>
						{automations.map((a) => (
							<tr key={a.id}>
								<td>{a.name}</td>
								<td>{a.prompt}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
