import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { PackageDef, PackageEval } from "../types";

export function PackagesView() {
	const [packages, setPackages] = useState<PackageDef[]>([]);
	const [evals, setEvals] = useState<PackageEval[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		Promise.all([
			apiFetch<PackageDef[]>("/api/packages").catch(() => []),
			apiFetch<PackageEval[]>("/api/state/package-evals").catch(() => []),
		])
			.then(([p, e]) => {
				setPackages(p);
				setEvals(e);
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error)
		return <div className="panel error">Error loading packages: {error}</div>;

	return (
		<div className="grid-2">
			<div className="panel">
				<div className="panel-title">Installed Packages</div>
				{packages.length === 0 ? (
					<div className="empty-state">No installed packages found.</div>
				) : (
					<ul style={{ paddingLeft: "20px" }}>
						{packages.map((p) => (
							<li key={p.id}>
								<strong>{p.name}</strong> - {p.version}
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="panel">
				<div className="panel-title">Package Evals</div>
				{evals.length === 0 ? (
					<div className="empty-state">No recent evals.</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>Package ID</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{evals.slice(0, 10).map((e) => (
								<tr key={e.id}>
									<td>{e.packageId}</td>
									<td>{e.status}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
