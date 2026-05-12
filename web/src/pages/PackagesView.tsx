import { useEffect, useState } from "react";
import { apiFetch } from "../api";

interface PackageInfo {
	name: string;
	version: string;
	source: string;
	installedAt: string;
	enabled: boolean;
	permissions: Array<{ kind: string; granted: boolean }>;
	validationStatus: string;
	workflows: string[];
	trustStatus?: string;
	signer?: string;
	lastEvalResult?: { total: number; passed: number; failed: number; runAt: string };
}

interface EvalRecord {
	id: string;
	packageName: string;
	status: string;
	durationMs: number;
	totalEvals: number;
	passedEvals: number;
	failedEvals: number;
	failedStep?: string;
	runAt: string;
}

export function PackagesView() {
	const [packages, setPackages] = useState<PackageInfo[]>([]);
	const [evalHistory, setEvalHistory] = useState<EvalRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	useEffect(() => {
		loadAll();
	}, []);

	const loadAll = async () => {
		setLoading(true);
		try {
			const [pkgs, evals] = await Promise.all([
				apiFetch<PackageInfo[]>("/api/packages"),
				apiFetch<EvalRecord[]>("/api/state/package-evals").catch(() => []),
			]);
			setPackages(pkgs ?? []);
			setEvalHistory(evals ?? []);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	const handleInstall = async () => {
		const source = prompt("Package source path or URL:");
		if (!source) return;
		setNotice(`Installing ${source}...`);
		try {
			await apiFetch("/api/packages", { method: "POST", body: JSON.stringify({ source }) });
			setNotice(`Package installed: ${source}`);
			await loadAll();
		} catch (err) {
			setError(`Install failed: ${String(err)}`);
		}
	};

	const handleReview = async (name: string, status: string) => {
		try {
			await apiFetch(`/api/packages/${encodeURIComponent(name)}/review`, {
				method: "POST",
				body: JSON.stringify({ status }),
			});
			setNotice(`Review ${status} for ${name}`);
			await loadAll();
		} catch (err) {
			setError(`Review failed: ${String(err)}`);
		}
	};

	const handleEval = async (name: string) => {
		setNotice(`Running eval for ${name}...`);
		try {
			await apiFetch(`/api/packages/${encodeURIComponent(name)}/eval`, { method: "POST" });
			setNotice(`Eval completed for ${name}`);
			await loadAll();
		} catch (err) {
			setError(`Eval failed: ${String(err)}`);
		}
	};

	if (loading) return <div className="panel"><div className="panel-title">Packages</div>Loading...</div>;
	if (error) return <div className="panel error">{error}</div>;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div className="panel">
				<div className="panel-title" style={{ display: "flex", justifyContent: "space-between" }}>
					<span>Installed Packages</span>
					<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
						<span style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>{packages.length} packages</span>
						<button type="button" className="button button-primary" onClick={handleInstall} style={{ fontSize: "0.75rem", padding: "4px 8px", height: "auto" }}>Install</button>
					</div>
				</div>

				{notice && <div style={{ color: "var(--accent-primary)", fontSize: "0.85rem", marginBottom: "8px" }}>{notice}</div>}

				{packages.length === 0 ? (
					<div style={{ color: "var(--text-tertiary)", padding: "24px", textAlign: "center" }}>
						No packages installed. Install from a local directory or remote source.
					</div>
				) : (
					packages.map((pkg) => (
						<div key={pkg.name} style={{ border: "1px solid var(--border-subtle)", borderRadius: "8px", padding: "16px", marginBottom: "12px" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
								<div>
									<strong>{pkg.name}</strong> <span style={{ color: "var(--text-tertiary)", fontSize: "0.85rem" }}>v{pkg.version}</span>
									{pkg.signer && <span style={{ marginLeft: "8px", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>signed: {pkg.signer}</span>}
								</div>
								<div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
									<span className={`status-${pkg.validationStatus === "valid" ? "ok" : "warn"}`} style={{ fontSize: "0.75rem" }}>
										{pkg.validationStatus}
									</span>
									{pkg.trustStatus && (
										<span style={{
											fontSize: "0.7rem", padding: "2px 6px", borderRadius: "4px",
											background: pkg.trustStatus === "approved" ? "rgba(16,185,129,0.1)" : pkg.trustStatus === "rejected" ? "rgba(244,63,94,0.1)" : "rgba(255,255,255,0.05)",
											color: pkg.trustStatus === "approved" ? "#10b981" : pkg.trustStatus === "rejected" ? "#f43f5e" : "var(--text-tertiary)"
										}}>
											{pkg.trustStatus}
										</span>
									)}
								</div>
							</div>

							<div style={{ marginTop: "8px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
								{pkg.permissions.map((p, i) => (
									<span key={i} style={{
										marginRight: "6px", padding: "2px 6px", borderRadius: "4px",
										background: p.granted ? "rgba(16,185,129,0.1)" : "rgba(244,63,94,0.05)",
										color: p.granted ? "#10b981" : "var(--text-tertiary)"
									}}>
										{p.granted ? "✓" : "✗"} {p.kind}
									</span>
								))}
							</div>

							{pkg.lastEvalResult && (
								<div style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
									Eval: {pkg.lastEvalResult.passed}/{pkg.lastEvalResult.total} passed at {pkg.lastEvalResult.runAt?.slice(0, 19)}
								</div>
							)}

							<div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
								{!pkg.trustStatus || pkg.trustStatus === "unreviewed" ? (
									<>
										<button type="button" className="button" style={{ fontSize: "0.75rem", padding: "4px 8px", height: "auto" }} onClick={() => handleReview(pkg.name, "approved")}>
											Approve
										</button>
										<button type="button" className="button" style={{ fontSize: "0.75rem", padding: "4px 8px", height: "auto" }} onClick={() => handleReview(pkg.name, "rejected")}>
											Reject
										</button>
									</>
								) : (
									<button type="button" className="button" style={{ fontSize: "0.75rem", padding: "4px 8px", height: "auto" }} onClick={() => handleReview(pkg.name, "unreviewed")}>
										Reset Review
									</button>
								)}
								<button type="button" className="button button-primary" style={{ fontSize: "0.75rem", padding: "4px 8px", height: "auto" }} onClick={() => handleEval(pkg.name)}>
									Run Eval
								</button>
							</div>
						</div>
					))
				)}
			</div>

			{evalHistory.length > 0 && (
				<div className="panel">
					<div className="panel-title">Eval History</div>
					<table style={{ fontSize: "0.8rem" }}>
						<thead>
							<tr>
								<th>Package</th>
								<th>Status</th>
								<th>Passed</th>
								<th>Failed</th>
								<th>Duration</th>
								<th>Run At</th>
							</tr>
						</thead>
						<tbody>
							{evalHistory.slice(0, 20).map((ev) => (
								<tr key={ev.id}>
									<td>{ev.packageName}</td>
									<td className={`status-${ev.status === "passed" ? "ok" : "warn"}`}>{ev.status}</td>
									<td>{ev.passedEvals}</td>
									<td>{ev.failedEvals}</td>
									<td>{(ev.durationMs / 1000).toFixed(1)}s</td>
									<td style={{ fontSize: "0.7rem" }}>{ev.runAt?.slice(0, 19)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
