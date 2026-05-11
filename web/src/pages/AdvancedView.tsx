import { useState } from "react";
import { apiFetch } from "../api";

export function AdvancedView() {
	const [cleanupConfirm, setCleanupConfirm] = useState("");
	const [cleanupStatus, setCleanupStatus] = useState("");
	const [isCleaning, setIsCleaning] = useState(false);

	const runDoctor = async () => {
		try {
			const res = await apiFetch("/api/doctor/run", { method: "POST" });
			alert(JSON.stringify(res, null, 2));
		} catch (err: unknown) {
			alert(
				`Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const performCleanup = async (dryRun: boolean) => {
		if (!dryRun && cleanupConfirm !== "DELETE_RUNTIME_TEMP") {
			setCleanupStatus("Error: Must type confirmation exactly.");
			return;
		}

		setIsCleaning(true);
		setCleanupStatus(dryRun ? "Starting dry run..." : "Starting deletion...");
		try {
			const result = await apiFetch("/api/data/cleanup", {
				method: "POST",
				body: JSON.stringify({
					dryRun,
					confirm: dryRun ? "" : cleanupConfirm,
				}),
			});
			setCleanupStatus(JSON.stringify(result, null, 2));
		} catch (err: unknown) {
			setCleanupStatus(
				`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setIsCleaning(false);
		}
	};

	return (
		<div className="advanced-view">
			<section className="panel">
				<div className="panel-title">System Diagnostics</div>
				<p style={{ marginBottom: "16px", color: "var(--text-secondary)" }}>
					Run the system doctor to check for common issues and
					misconfigurations.
				</p>
				<button
					type="button"
					className="button button-primary"
					onClick={runDoctor}
				>
					Run Doctor Diagnostics
				</button>
			</section>

			<section className="panel">
				<div className="panel-title">Durable State & Storage Maintenance</div>
				<div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
					<div>
						<h4 style={{ marginBottom: "8px" }}>Runtime Cleanup</h4>
						<p
							style={{
								marginBottom: "12px",
								color: "var(--text-secondary)",
								fontSize: "0.9rem",
							}}
						>
							Deletes temporary profiles, downloads, and automation scratch
							files. This is a destructive operation.
						</p>

						<div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
							<button
								type="button"
								className="button"
								disabled={isCleaning}
								onClick={() => performCleanup(true)}
							>
								Dry Run Cleanup
							</button>

							<div style={{ flex: 1, display: "flex", gap: "8px" }}>
								<input
									type="text"
									placeholder='Type "DELETE_RUNTIME_TEMP" to confirm'
									value={cleanupConfirm}
									onChange={(e) => setCleanupConfirm(e.target.value)}
									style={{
										flex: 1,
										padding: "8px 12px",
										borderRadius: "6px",
										border: "1px solid var(--border-strong)",
										background: "var(--bg-app)",
										color: "var(--text-primary)",
									}}
								/>
								<button
									type="button"
									className="button"
									style={{
										backgroundColor: "#ef4444",
										color: "white",
										borderColor: "#ef4444",
									}}
									disabled={
										isCleaning || cleanupConfirm !== "DELETE_RUNTIME_TEMP"
									}
									onClick={() => performCleanup(false)}
								>
									Confirm Deletion
								</button>
							</div>
						</div>

						{cleanupStatus && (
							<pre
								style={{
									marginTop: "16px",
									padding: "12px",
									background: "#000",
									borderRadius: "6px",
									fontSize: "0.85rem",
									overflowX: "auto",
								}}
							>
								{cleanupStatus}
							</pre>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}
