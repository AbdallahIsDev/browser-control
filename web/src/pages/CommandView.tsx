import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api";
import type { Task } from "../types";

export function CommandView() {
	const [prompt, setPrompt] = useState("");
	const [notice, setNotice] = useState("");
	const [activeTasks, setActiveTasks] = useState<Task[]>([]);

	const loadActiveTasks = useCallback(async () => {
		try {
			const tasks = await apiFetch<Task[]>("/api/tasks");
			setActiveTasks(
				tasks.filter(
					(task) => task.status === "running" || task.status === "pending",
				),
			);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		loadActiveTasks();
		const timer = setInterval(loadActiveTasks, 5000);
		return () => clearInterval(timer);
	}, [loadActiveTasks]);

	const handleRun = async () => {
		if (!prompt) return;
		setNotice("Submitting task...");
		try {
			await apiFetch("/api/tasks", {
				method: "POST",
				body: JSON.stringify({ prompt, action: prompt.slice(0, 48) }),
			});
			setNotice("Task queued.");
			setPrompt("");
			await loadActiveTasks();
		} catch (err: unknown) {
			setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const handleSaveAutomation = async () => {
		if (!prompt) return;
		setNotice("Saving automation...");
		try {
			await apiFetch("/api/saved-automations", {
				method: "POST",
				body: JSON.stringify({
					name: prompt.slice(0, 48),
					description: "Saved from Command workspace",
					category: "Command",
					prompt,
					approvalRequired: true,
				}),
			});
			setNotice("Automation saved.");
			setPrompt("");
		} catch (err: unknown) {
			setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	return (
		<div className="command-workspace-layout">
			<div className="workspace-grid">
				<div className="main-command-panel">
					<div
						className="panel"
						style={{
							minHeight: "400px",
							display: "flex",
							flexDirection: "column",
						}}
					>
						<div className="panel-title">
							<h3>Intent & Execution</h3>
						</div>
						<p
							style={{
								color: "var(--text-tertiary)",
								marginBottom: "16px",
								fontSize: "0.9rem",
							}}
						>
							Enter your objective. The agent will analyze, plan, and execute
							across browser and terminal.
						</p>

						{notice && (
							<div
								style={{
									color: "var(--accent-primary)",
									marginBottom: "12px",
									fontSize: "0.9rem",
									fontWeight: 600,
								}}
							>
								{notice}
							</div>
						)}

						<textarea
							placeholder="e.g. Find the latest ICT trade ideas on TradingView for BTC/USD and prepare an analysis report..."
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							style={{ flex: 1, minHeight: "200px" }}
						/>

						<div className="command-actions">
							<button
								type="button"
								className="button button-primary"
								onClick={handleRun}
								style={{ padding: "0 24px" }}
							>
								Submit Intent
							</button>
							<button
								type="button"
								className="button"
								onClick={handleSaveAutomation}
							>
								Save as Automation
							</button>
						</div>
					</div>
				</div>

				<div className="workspace-side-panels">
					<div className="panel">
						<div className="panel-title">Active Tasks</div>
						{activeTasks.length === 0 ? (
							<div
								className="empty-state"
								style={{ padding: "12px", fontSize: "0.8rem" }}
							>
								No tasks running.
							</div>
						) : (
							<div
								style={{ display: "flex", flexDirection: "column", gap: "8px" }}
							>
								{activeTasks.map((t) => (
									<div
										key={t.id}
										style={{
											padding: "8px",
											background: "rgba(255,255,255,0.03)",
											borderRadius: "6px",
											fontSize: "0.8rem",
										}}
									>
										<div
											style={{
												fontWeight: 600,
												color: "var(--accent-primary)",
											}}
										>
											{t.id}
										</div>
										<div style={{ color: "var(--text-tertiary)" }}>
											{t.status}
										</div>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="panel">
						<div className="panel-title">System Load</div>
						<div style={{ fontSize: "0.85rem" }}>
							<div
								style={{
									marginBottom: "8px",
									display: "flex",
									justifyContent: "space-between",
								}}
							>
								<span style={{ color: "var(--text-tertiary)" }}>CPU</span>
								<span>Healthy</span>
							</div>
							<div
								style={{
									marginBottom: "8px",
									display: "flex",
									justifyContent: "space-between",
								}}
							>
								<span style={{ color: "var(--text-tertiary)" }}>Memory</span>
								<span>Optimized</span>
							</div>
							<div style={{ display: "flex", justifyContent: "space-between" }}>
								<span style={{ color: "var(--text-tertiary)" }}>
									CDP Bridge
								</span>
								<span className="status-ok">Active</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
