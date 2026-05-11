import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { EvidenceRecord } from "../types";

export function EvidenceView() {
	const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		apiFetch<EvidenceRecord[]>("/api/state/evidence")
			.catch(() => [])
			.then(setEvidence)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error)
		return <div className="panel error">Error loading evidence: {error}</div>;

	return (
		<div className="panel">
			<div className="panel-title">Evidence & Debug Bundles</div>
			{evidence.length === 0 ? (
				<div className="empty-state">No evidence found.</div>
			) : (
				<table>
					<thead>
						<tr>
							<th>ID</th>
							<th>Type</th>
							<th>Path</th>
						</tr>
					</thead>
					<tbody>
						{evidence.map((e) => (
							<tr key={e.id}>
								<td>{e.id}</td>
								<td>{e.type}</td>
								<td>{e.path}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
