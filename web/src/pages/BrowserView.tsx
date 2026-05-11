import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { AppStatus } from "../types";

export function BrowserView() {
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		apiFetch<AppStatus>("/api/status")
			.then(setStatus)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error)
		return (
			<div className="panel error">Error loading browser status: {error}</div>
		);

	return (
		<div className="panel">
			<div className="panel-title">Browser Session</div>
			{status?.browser?.activeSessions && status.browser.activeSessions > 0 ? (
				<div className="grid-2">
					<div className="panel">
						<div style={{ color: "var(--fg-muted)", marginBottom: "4px" }}>
							Provider
						</div>
						<div style={{ fontSize: "1.2rem", fontWeight: 600 }}>
							{status.browser.provider || "Unknown"}
						</div>
					</div>
					<div className="panel">
						<div style={{ color: "var(--fg-muted)", marginBottom: "4px" }}>
							Sessions
						</div>
						<div style={{ fontSize: "1.2rem", fontWeight: 600 }}>
							{status.browser.activeSessions}
						</div>
					</div>
				</div>
			) : (
				<div className="empty-state">No active browser sessions.</div>
			)}
			<div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
				<button type="button" className="button button-primary">
					Open URL
				</button>
				<button type="button" className="button">
					Take Screenshot
				</button>
			</div>
		</div>
	);
}
