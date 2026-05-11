import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";

interface TerminalSession {
	id: string;
	name?: string;
	shell: string;
	cwd: string;
	status: "idle" | "running" | "interrupted" | "closed";
	createdAt: string;
}

interface TerminalSnapshot {
	sessionId: string;
	status: string;
	lastOutput: string;
	promptDetected: boolean;
	runningCommand?: string;
	shell: string;
	cwd: string;
}

interface TerminalOutputRow {
	index: number;
	text: string;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][0-9;]*[^\x07]*\x07/g, "");
}

function getToken() {
	return sessionStorage.getItem("bc-token") || "";
}

export function TerminalView() {
	const [sessions, setSessions] = useState<TerminalSession[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [output, setOutput] = useState<TerminalOutputRow[]>([]);
	const [command, setCommand] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const outputRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const cols = 80;
	const rows = 24;

	const scrollToBottom = () => {
		if (outputRef.current) {
			outputRef.current.scrollTop = outputRef.current.scrollHeight;
		}
	};

	const loadSessions = useCallback(async () => {
		try {
			const result = await apiFetch<{ success: boolean; data?: TerminalSession[] }>("/api/terminal/sessions");
			const list = result.data ?? [];
			setSessions(list);
			if (activeSessionId && !list.find((s) => s.id === activeSessionId)) {
				setActiveSessionId(null);
				setOutput([]);
			}
		} catch {
			// ignore
		}
	}, [activeSessionId]);

	useEffect(() => {
		loadSessions();
		const timer = setInterval(loadSessions, 5000);
		return () => clearInterval(timer);
	}, [loadSessions]);

	// WebSocket for live terminal output
	useEffect(() => {
		const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events?token=${encodeURIComponent(getToken())}`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === "terminal.output" && msg.payload?.sessionId === activeSessionId) {
					const data = stripAnsi(msg.payload.data ?? "");
					setOutput((prev) => {
						const lines = data.split(/\r?\n/).filter((l: string) => l.length > 0);
						const newRows = lines.map((text: string, i: number) => ({
							index: prev.length + i,
							text,
						}));
						return [...prev, ...newRows].slice(-500);
					});
				}
			} catch {
				// ignore
			}
		};

		return () => {
			ws.close();
			wsRef.current = null;
		};
	}, [activeSessionId]);

	useEffect(() => {
		scrollToBottom();
	}, [output]);

	const createSession = async () => {
		setLoading(true);
		setError("");
		try {
			const result = await apiFetch<{ success: boolean; data?: { id: string } }>("/api/terminal/sessions", {
				method: "POST",
				body: JSON.stringify({ name: `session-${Date.now()}`, cols, rows }),
			});
			const id = result.data?.id;
			if (id) {
				await loadSessions();
				setActiveSessionId(id);
				setOutput([]);
			}
		} catch (err: unknown) {
			setError(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setLoading(false);
		}
	};

	const selectSession = async (sessionId: string) => {
		setActiveSessionId(sessionId);
		setError("");
		try {
			const result = await apiFetch<{ success: boolean; data?: TerminalSnapshot }>(
				`/api/terminal/sessions/${encodeURIComponent(sessionId)}/snapshot`,
			);
			if (result.data?.lastOutput) {
				const lines = stripAnsi(result.data.lastOutput).split(/\r?\n/).filter(Boolean);
				setOutput(
					lines.map((text: string, i: number) => ({ index: i, text })),
				);
			} else {
				setOutput([]);
			}
		} catch (err: unknown) {
			setError(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const sendCommand = async () => {
		if (!activeSessionId || !command.trim()) return;
		setNotice(`Running: ${command}`);
		try {
			await apiFetch(`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/input`, {
				method: "POST",
				body: JSON.stringify({ text: command.trim() }),
			});
			setCommand("");
			setNotice(`Command sent: ${command.trim()}`);
			setTimeout(() => selectSession(activeSessionId), 500);
		} catch (err: unknown) {
			setError(`Failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const handleInterrupt = async () => {
		if (!activeSessionId) return;
		try {
			await apiFetch(`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/interrupt`, {
				method: "POST",
			});
			setNotice("Interrupted (Ctrl+C)");
		} catch (err: unknown) {
			setError(`Interrupt failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const closeSession = async (sessionId: string) => {
		try {
			await apiFetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}`, {
				method: "DELETE",
			});
			if (activeSessionId === sessionId) {
				setActiveSessionId(null);
				setOutput([]);
			}
			await loadSessions();
		} catch (err: unknown) {
			setError(`Close failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const clearOutput = () => {
		setOutput([]);
	};

	const handleCopy = () => {
		const text = output.map((r) => r.text).join("\n");
		navigator.clipboard.writeText(text).then(() => setNotice("Copied to clipboard"));
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendCommand();
		}
	};

	const activeSession = sessions.find((s) => s.id === activeSessionId);

	return (
		<div className="terminal-workspace" style={{ display: "flex", height: "calc(100vh - 128px)", gap: "16px" }}>
			<div className="panel" style={{ width: "280px", flexShrink: 0, overflow: "auto" }}>
				<div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<span>Sessions</span>
					<button type="button" className="button button-primary" onClick={createSession} disabled={loading} style={{ fontSize: "0.8rem", padding: "4px 12px", height: "auto" }}>
						{loading ? "..." : "New"}
					</button>
				</div>
				{sessions.length === 0 ? (
					<div style={{ padding: "16px", color: "var(--text-tertiary)", fontSize: "0.85rem", textAlign: "center" }}>
						No terminal sessions. Click <strong>New</strong> to create one.
					</div>
				) : (
					sessions.map((s) => (
						<div
							key={s.id}
							className={`nav-item ${s.id === activeSessionId ? "active" : ""}`}
							style={{ cursor: "pointer", fontSize: "0.8rem", justifyContent: "space-between" }}
						>
							<div onClick={() => selectSession(s.id)} style={{ flex: 1 }}>
								<div style={{ fontWeight: 600 }}>{s.name || s.id.slice(0, 8)}</div>
								<div style={{ color: "var(--text-tertiary)", fontSize: "0.7rem" }}>{s.shell} · {s.status}</div>
							</div>
							<button
								type="button"
								onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
								style={{ background: "none", border: "none", color: "var(--status-warn)", cursor: "pointer", fontSize: "1rem", padding: "4px" }}
								aria-label={`Close session ${s.name || s.id}`}
							>
								✕
							</button>
						</div>
					))
				)}
			</div>

			<div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
				<div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
					<span>{activeSession ? `Terminal — ${activeSession.name || activeSession.id.slice(0, 12)}` : "Terminal"}</span>
					<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
						{activeSession && (
							<>
								<button type="button" className="button" onClick={handleInterrupt} style={{ fontSize: "0.8rem", padding: "4px 8px", height: "auto" }}>Ctrl+C</button>
								<button type="button" className="button" onClick={handleCopy} style={{ fontSize: "0.8rem", padding: "4px 8px", height: "auto" }}>Copy</button>
								<button type="button" className="button" onClick={clearOutput} style={{ fontSize: "0.8rem", padding: "4px 8px", height: "auto" }}>Clear</button>
							</>
						)}
					</div>
				</div>

				{error && (
					<div style={{ padding: "8px 12px", background: "rgba(244,63,94,0.08)", color: "var(--status-warn)", borderRadius: "6px", marginBottom: "12px", fontSize: "0.85rem" }}>
						{error}
						<button type="button" onClick={() => setError("")} style={{ marginLeft: "8px", background: "none", border: "none", color: "inherit", cursor: "pointer" }}>✕</button>
					</div>
				)}
				{notice && (
					<div style={{ padding: "4px 12px", color: "var(--text-tertiary)", fontSize: "0.8rem", marginBottom: "4px" }}>
						{notice}
					</div>
				)}

				{!activeSession ? (
					<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", fontSize: "0.9rem" }}>
						{loading ? "Creating session..." : "Select or create a terminal session to begin."}
					</div>
				) : (
					<>
						<div
							ref={outputRef}
							role="log"
							aria-label="Terminal output"
							style={{
								flex: 1,
								background: "#0d1117",
								color: "#e6edf3",
								fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
								fontSize: "0.8rem",
								lineHeight: "1.5",
								padding: "12px",
								borderRadius: "8px",
								overflow: "auto",
								whiteSpace: "pre-wrap",
								wordBreak: "break-all",
								minHeight: "200px",
							}}
						>
							{output.length === 0 ? (
								<span style={{ color: "#8b949e" }}>Waiting for output...</span>
							) : (
								output.map((row) => (
									<div key={row.index}>{row.text}</div>
								))
							)}
						</div>

						<div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center" }}>
							<label htmlFor="term-input" style={{ fontSize: "0.8rem", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
								{activeSession?.cwd || "~"}$
							</label>
							<input
								id="term-input"
								ref={inputRef}
								type="text"
								value={command}
								onChange={(e) => setCommand(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="Enter command..."
								style={{ flex: 1 }}
								autoFocus
							/>
							<button type="button" className="button button-primary" onClick={sendCommand} style={{ padding: "7px 16px" }}>
								Run
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
