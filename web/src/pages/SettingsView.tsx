import { useEffect, useState } from "react";
import { apiFetch } from "../api";

interface Settings {
	theme?: string;
	dataHome?: string;
	policyProfile?: string;
	provider?: string;
	browserProvider?: string;
}

export function SettingsView() {
	const [settings, setSettings] = useState<Settings>({});
	const [error, setError] = useState("");
	const [providerName, setProviderName] = useState("local");
	const [cleanupConfirm, setCleanupConfirm] = useState("");
	const [message, setMessage] = useState("");
	const [modelProvider, setModelProvider] = useState("openrouter");
	const [modelEndpoint, setModelEndpoint] = useState("");
	const [modelKey, setModelKey] = useState("");
	const [modelName, setModelName] = useState("");

	useEffect(() => {
		apiFetch<Settings>("/api/settings")
			.catch((): Settings => ({}))
			.then((next) => {
				setSettings(next);
				setProviderName(next.browserProvider || next.provider || "local");
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	const saveProvider = async () => {
		setMessage("Saving provider...");
		try {
			await apiFetch("/api/browser/providers/use", {
				method: "POST",
				body: JSON.stringify({ name: providerName }),
			});
			setMessage(`Provider saved: ${providerName}`);
		} catch (err: unknown) {
			setMessage(
				`Provider save failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const runCleanup = async (dryRun: boolean, confirm?: string) => {
		setMessage(dryRun ? "Running cleanup preview..." : "Running cleanup...");
		try {
			const result = await apiFetch<{
				deleted?: string[];
				wouldDelete?: string[];
				freedBytes?: number;
				error?: string;
			}>("/api/data/cleanup", {
				method: "POST",
				body: JSON.stringify({ dryRun, confirm }),
			});
			const count = (result.deleted || result.wouldDelete || []).length;
			setMessage(
				`${dryRun ? "Cleanup preview" : "Cleanup"} complete: ${count} runtime paths, ${result.freedBytes || 0} bytes.`,
			);
		} catch (err: unknown) {
			setMessage(
				`Cleanup blocked: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	if (error)
		return <div className="panel error">Error loading settings: {error}</div>;

	return (
		<div className="panel">
			<div className="panel-title">System Settings</div>
			{message && (
				<div className="inline-status" role="status">
					{message}
				</div>
			)}
			<div style={{ marginBottom: "16px" }}>
				<div style={{ color: "var(--fg-muted)", marginBottom: "4px" }}>
					Data Home Directory
				</div>
				<div
					style={{
						padding: "8px",
						background: "var(--bg)",
						border: "1px solid var(--border)",
						borderRadius: "4px",
					}}
				>
					{settings.dataHome || "Not configured"}
				</div>
			</div>
			<div style={{ marginBottom: "16px" }}>
				<div style={{ color: "var(--fg-muted)", marginBottom: "4px" }}>
					AI Provider
				</div>
				<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
					<input
						value={providerName}
						onChange={(event) => setProviderName(event.target.value)}
						placeholder="local"
					/>
					<button type="button" className="button" onClick={saveProvider}>
						Save Provider
					</button>
				</div>
			</div>
			<div style={{ marginBottom: "16px" }}>
				<div style={{ color: "var(--fg-muted)", marginBottom: "4px" }}>
					Model Provider
				</div>
				<div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
					<select value={modelProvider} onChange={(e) => setModelProvider(e.target.value)} style={{ padding: "6px 8px", borderRadius: "4px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
						<option value="openrouter">OpenRouter</option>
						<option value="ollama">Ollama</option>
						<option value="openai-compatible">Custom (OpenAI Compatible)</option>
					</select>
				</div>
				{modelProvider === "openai-compatible" && (
					<div style={{ marginBottom: "6px" }}>
						<input value={modelEndpoint} onChange={(e) => setModelEndpoint(e.target.value)} placeholder="http://localhost:8080/v1" style={{ width: "100%", marginBottom: "4px" }} />
					</div>
				)}
				<div style={{ marginBottom: "6px" }}>
					<input value={modelKey} onChange={(e) => setModelKey(e.target.value)} type="password" placeholder="API Key" style={{ width: "100%", marginBottom: "4px" }} />
				</div>
				<div style={{ marginBottom: "6px" }}>
					<input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Model name (e.g. gpt-4o)" style={{ width: "100%", marginBottom: "4px" }} />
				</div>
				<button type="button" className="button" onClick={async () => {
					setMessage("Saving model config...");
					try {
						await apiFetch("/api/config/modelProvider", { method: "POST", body: JSON.stringify({ modelProvider, modelEndpoint, modelKey, modelName }) });
						setMessage("Model config saved");
					} catch (e) { setMessage(`Failed: ${String(e)}`); }
				}}>
					Save Model Config
				</button>
			</div>
			<div style={{ marginBottom: "16px" }}>
				<div style={{ color: "var(--fg-muted)", marginBottom: "4px" }}>
					Runtime Cleanup
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<div style={{ display: "flex", gap: "8px" }}>
						<button
							type="button"
							className="button"
							onClick={() => runCleanup(true)}
						>
							Preview Cleanup
						</button>
					</div>

					<div
						style={{
							padding: "16px",
							background: "rgba(244, 63, 94, 0.05)",
							border: "1px solid rgba(244, 63, 94, 0.1)",
							borderRadius: "8px",
						}}
					>
						<div
							style={{
								color: "var(--status-warn)",
								fontSize: "0.9rem",
								marginBottom: "8px",
								fontWeight: "600",
							}}
						>
							Destructive Action
						</div>
						<div
							style={{
								fontSize: "0.85rem",
								color: "var(--text-secondary)",
								marginBottom: "12px",
							}}
						>
							This will delete all temporary runtime data, including session
							logs and transient browser profiles. Type{" "}
							<strong>DELETE_RUNTIME_TEMP</strong> to confirm.
						</div>
						<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
							<input
								style={{ flex: 1 }}
								value={cleanupConfirm}
								onChange={(event) => setCleanupConfirm(event.target.value)}
								placeholder="DELETE_RUNTIME_TEMP"
							/>
							<button
								type="button"
								className="button button-primary"
								style={{
									background:
										cleanupConfirm === "DELETE_RUNTIME_TEMP"
											? "var(--status-warn)"
											: "var(--bg-surface)",
									opacity: cleanupConfirm === "DELETE_RUNTIME_TEMP" ? 1 : 0.5,
								}}
								disabled={cleanupConfirm !== "DELETE_RUNTIME_TEMP"}
								onClick={() => runCleanup(false, cleanupConfirm)}
							>
								Delete Permanently
							</button>
						</div>
					</div>
				</div>
			</div>
			<div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
				<button type="button" className="button">
					Export Configuration
				</button>
			</div>
		</div>
	);
}
