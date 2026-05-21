import {
	ClipboardPaste,
	Copy,
	PanelLeftClose,
	Play,
	Plus,
	RefreshCw,
	Square,
	Trash2,
} from "lucide-react";
import {
	type ButtonHTMLAttributes,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { apiFetch } from "../api";

interface TerminalSession {
	id: string;
	name?: string;
	shell: string;
	cwd: string;
	status: "idle" | "running" | "interrupted" | "closed" | string;
	createdAt?: string;
}

interface TerminalSegment {
	text: string;
	bold?: boolean;
	dim?: boolean;
	underline?: boolean;
	foreground?: string;
	background?: string;
}

interface TerminalOutputRow {
	index: number;
	text: string;
	segments?: TerminalSegment[];
}

interface BrowserTerminalView {
	terminalSessionId: string;
	title: string;
	status: "idle" | "running" | "exited" | "failed";
	rows: TerminalOutputRow[];
	cursor?: { row: number; column: number; visible: boolean };
	canAcceptInput: boolean;
	lastActivityAt: string;
}

interface ApiResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

const MAX_ROWS = 600;
const MOBILE_OVERFLOW_VERIFICATION = "scrollWidth <= innerWidth";

function getToken() {
	return sessionStorage.getItem("bc-token") || "";
}

function stripAnsi(text: string): string {
	const escapeChar = String.fromCharCode(27);
	const bell = String.fromCharCode(7);
	return text
		.replace(new RegExp(`${escapeChar}\\[[0-9;]*[a-zA-Z]`, "g"), "")
		.replace(new RegExp(`${escapeChar}\\][0-9;]*[^${bell}]*${bell}`, "g"), "");
}

function appendLiveOutput(
	rows: TerminalOutputRow[],
	chunk: string,
): TerminalOutputRow[] {
	const clean = stripAnsi(chunk).replace(/\r/g, "\n");
	const next = [...rows];
	let nextIndex = rows.length > 0 ? rows[rows.length - 1].index + 1 : 0;
	for (const line of clean.split(/\n/u)) {
		if (!line) continue;
		next.push({
			index: nextIndex,
			text: line,
			segments: [{ text: line }],
		});
		nextIndex += 1;
	}
	return next.length > MAX_ROWS ? next.slice(-MAX_ROWS) : next;
}

function statusVariant(status: string): "ok" | "warn" | "info" | "neutral" {
	if (status === "idle") return "ok";
	if (status === "running") return "info";
	if (status === "interrupted") return "warn";
	if (status === "closed" || status === "exited" || status === "failed")
		return "warn";
	return "neutral";
}

function explainTerminalError(raw: string): {
	message: string;
	details?: string;
} {
	const lower = raw.toLowerCase();
	const details = `Technical details: ${raw}`;
	if (lower.includes("http 429") || lower.includes("rate limit")) {
		return {
			message: "Terminal runtime is busy.",
			details:
				"Wait a moment and try again. Browser Control is protecting the terminal service from too many requests. " +
				details,
		};
	}
	if (
		lower.includes("broker api error") ||
		lower.includes("127.0.0.1:7788") ||
		lower.includes("fetch failed")
	) {
		return {
			message: "Terminal runtime is offline.",
			details:
				"Start the Browser Control daemon, then create or attach a terminal session again. " +
				details,
		};
	}
	return { message: raw };
}

function segmentClass(segment: TerminalSegment): string {
	const foreground: Record<string, string> = {
		black: "text-zinc-500",
		red: "text-red-400",
		green: "text-emerald-400",
		yellow: "text-yellow-300",
		blue: "text-sky-400",
		magenta: "text-fuchsia-400",
		cyan: "text-cyan-300",
		white: "text-zinc-100",
		"bright-black": "text-zinc-400",
		"bright-red": "text-red-300",
		"bright-green": "text-emerald-300",
		"bright-yellow": "text-yellow-200",
		"bright-blue": "text-sky-300",
		"bright-magenta": "text-fuchsia-300",
		"bright-cyan": "text-cyan-200",
		"bright-white": "text-white",
	};
	return cn(
		segment.bold && "font-semibold",
		segment.dim && "opacity-70",
		segment.underline && "underline",
		segment.foreground && foreground[segment.foreground],
	);
}

function ToolButton({
	label,
	children,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label={label}
						{...props}
					>
						{children}
					</Button>
				}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function renderRow(row: TerminalOutputRow) {
	const segments = row.segments?.length ? row.segments : [{ text: row.text }];
	let offset = 0;
	return segments.map((segment) => {
		const key = `${row.index}-${offset}-${segment.text.slice(0, 8)}`;
		offset += segment.text.length;
		return (
			<span key={key} className={segmentClass(segment)}>
				{segment.text}
			</span>
		);
	});
}

export function TerminalView() {
	const [sessions, setSessions] = useState<TerminalSession[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [buffers, setBuffers] = useState<Record<string, TerminalOutputRow[]>>(
		{},
	);
	const [views, setViews] = useState<Record<string, BrowserTerminalView>>({});
	const [command, setCommand] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [pendingClose, setPendingClose] = useState<TerminalSession | null>(
		null,
	);
	const [pendingPaste, setPendingPaste] = useState<string | null>(null);
	const [terminalSize, setTerminalSize] = useState({ cols: 80, rows: 24 });
	const outputRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const activeSession = useMemo(
		() => sessions.find((session) => session.id === activeSessionId),
		[sessions, activeSessionId],
	);
	const activeRows = activeSessionId ? (buffers[activeSessionId] ?? []) : [];
	const activeView = activeSessionId ? views[activeSessionId] : undefined;
	const terminalError = error ? explainTerminalError(error) : null;

	const loadRender = useCallback(async (sessionId: string) => {
		const result = await apiFetch<ApiResult<BrowserTerminalView>>(
			`/api/terminal/sessions/${encodeURIComponent(sessionId)}/render`,
		);
		if (!result.success || !result.data) {
			throw new Error(result.error || "Render unavailable.");
		}
		setViews((prev) => ({
			...prev,
			[sessionId]: result.data as BrowserTerminalView,
		}));
		setBuffers((prev) => ({
			...prev,
			[sessionId]: (result.data?.rows ?? []).slice(-MAX_ROWS),
		}));
	}, []);

	const loadSessions = useCallback(async () => {
		const result = await apiFetch<ApiResult<TerminalSession[]>>(
			"/api/terminal/sessions",
		);
		const list = result.data ?? [];
		setSessions(list);
		if (
			activeSessionId &&
			!list.find((session) => session.id === activeSessionId)
		) {
			setActiveSessionId(null);
		}
	}, [activeSessionId]);

	useEffect(() => {
		loadSessions().catch((err: unknown) => {
			setError(err instanceof Error ? err.message : String(err));
		});
		const timer = setInterval(() => {
			loadSessions().catch(() => undefined);
		}, 5000);
		return () => clearInterval(timer);
	}, [loadSessions]);

	useEffect(() => {
		const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/events`;
		const ws = new WebSocket(wsUrl, [getToken()]);
		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type !== "terminal.output" || !msg.payload?.sessionId) return;
				const sessionId = String(msg.payload.sessionId);
				const data = String(msg.payload.data ?? "");
				setBuffers((prev) => ({
					...prev,
					[sessionId]: appendLiveOutput(prev[sessionId] ?? [], data),
				}));
			} catch {
				/* ignore malformed event replay */
			}
		};
		ws.onerror = () => setNotice("Terminal event stream disconnected.");
		return () => ws.close();
	}, []);

	useEffect(() => {
		const node = viewportRef.current;
		if (!node) return;
		const observer = new ResizeObserver(([entry]) => {
			const width = entry?.contentRect.width ?? node.clientWidth;
			const height = entry?.contentRect.height ?? node.clientHeight;
			const cols = Math.max(20, Math.min(500, Math.floor(width / 8)));
			const rows = Math.max(5, Math.min(200, Math.floor(height / 18)));
			setTerminalSize((prev) =>
				prev.cols === cols && prev.rows === rows ? prev : { cols, rows },
			);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!activeSessionId) return;
		const timer = window.setTimeout(() => {
			apiFetch(
				`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/resize`,
				{
					method: "POST",
					body: JSON.stringify(terminalSize),
				},
			).catch(() => undefined);
		}, 250);
		return () => window.clearTimeout(timer);
	}, [activeSessionId, terminalSize]);

	useEffect(() => {
		if (outputRef.current) {
			outputRef.current.scrollTop = outputRef.current.scrollHeight;
		}
	});

	const selectSession = async (sessionId: string) => {
		setActiveSessionId(sessionId);
		setError("");
		try {
			await loadRender(sessionId);
		} catch (err: unknown) {
			setError(
				`Attach failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const createSession = async () => {
		setLoading(true);
		setError("");
		try {
			const result = await apiFetch<ApiResult<{ id: string }>>(
				"/api/terminal/sessions",
				{
					method: "POST",
					body: JSON.stringify({
						name: `session-${Date.now()}`,
						cols: terminalSize.cols,
						rows: terminalSize.rows,
					}),
				},
			);
			const id = result.data?.id;
			if (!id)
				throw new Error(result.error || "Terminal session was not created.");
			await loadSessions();
			await selectSession(id);
			inputRef.current?.focus();
		} catch (err: unknown) {
			setError(
				`Create failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setLoading(false);
		}
	};

	const sendInput = async (text: string, submit = true) => {
		if (!activeSessionId || !text) return;
		await apiFetch(
			`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/input`,
			{
				method: "POST",
				body: JSON.stringify({ text, submit }),
			},
		);
		setTimeout(() => {
			loadRender(activeSessionId).catch(() => undefined);
		}, 300);
	};

	const sendCommand = async () => {
		const nextCommand = command.trim();
		if (!activeSessionId || !nextCommand) return;
		setNotice(`Command sent: ${nextCommand}`);
		try {
			await sendInput(nextCommand, true);
			setCommand("");
		} catch (err: unknown) {
			setError(
				`Run failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const pasteClipboard = async () => {
		if (!activeSessionId) return;
		try {
			const text = await navigator.clipboard.readText();
			if (requiresPasteConfirmation(text)) {
				setPendingPaste(text);
				return;
			}
			await pasteText(text);
		} catch (err: unknown) {
			setError(
				`Paste failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const confirmPendingPaste = async () => {
		const text = pendingPaste;
		setPendingPaste(null);
		if (!text) return;
		try {
			await pasteText(text);
		} catch (err: unknown) {
			setError(
				`Paste failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const pasteText = async (text: string) => {
		// submit: false keeps paste from pressing Enter.
		await sendInput(text, false);
		setNotice("Pasted without Enter.");
	};

	const handleInterrupt = async () => {
		if (!activeSessionId) return;
		try {
			await apiFetch(
				`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/interrupt`,
				{ method: "POST" },
			);
			setNotice("Interrupted.");
			await loadRender(activeSessionId);
		} catch (err: unknown) {
			setError(
				`Interrupt failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const closeSession = async (session: TerminalSession) => {
		try {
			await apiFetch(
				`/api/terminal/sessions/${encodeURIComponent(session.id)}`,
				{
					method: "DELETE",
				},
			);
			if (activeSessionId === session.id) setActiveSessionId(null);
			setBuffers((prev) => {
				const next = { ...prev };
				delete next[session.id];
				return next;
			});
			await loadSessions();
		} catch (err: unknown) {
			setError(
				`Close failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const copyOutput = async () => {
		try {
			await navigator.clipboard.writeText(
				activeRows.map((row) => row.text).join("\n"),
			);
			setNotice("Output copied.");
		} catch (err: unknown) {
			setError(
				`Copy failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const clearOutput = () => {
		if (!activeSessionId) return;
		setBuffers((prev) => ({ ...prev, [activeSessionId]: [] }));
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void sendCommand();
		} else if (event.ctrlKey && event.key.toLowerCase() === "c") {
			event.preventDefault();
			void handleInterrupt();
		} else if (event.ctrlKey && event.key.toLowerCase() === "l") {
			event.preventDefault();
			clearOutput();
		}
	};

	return (
		<PageShell>
			<TooltipProvider>
				<div
					className="grid h-[calc(100vh-64px)] max-w-full grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]"
					data-overflow-check={MOBILE_OVERFLOW_VERIFICATION}
				>
					<Card className="min-w-0 overflow-hidden">
						<CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
							<div className="min-w-0">
								<CardTitle className="text-sm">Terminal Sessions</CardTitle>
								<p className="mt-1 text-xs text-muted-foreground">
									{sessions.length} active
								</p>
							</div>
							<Button
								type="button"
								size="sm"
								onClick={createSession}
								disabled={loading}
								aria-label="Create terminal session"
							>
								<Plus className="mr-2 h-4 w-4" />
								New
							</Button>
						</CardHeader>
						<CardContent className="max-h-[32vh] overflow-auto p-0 lg:max-h-[calc(100vh-230px)]">
							{loading && sessions.length === 0 ? (
								<LoadingState message="Creating session..." className="px-4" />
							) : sessions.length === 0 ? (
								<EmptyState
									title="No terminal sessions"
									description="Create one to start an interactive shell."
									action={
										<Button type="button" size="sm" onClick={createSession}>
											<Plus className="mr-2 h-4 w-4" />
											New session
										</Button>
									}
								/>
							) : (
								<div className="min-w-0 overflow-x-auto">
									<DataTable
										data={sessions}
										emptyMessage="No terminal sessions"
										rowKey={(session) => session.id}
										columns={[
											{
												key: "session",
												header: "Session",
												cell: (session) => (
													<Button
														type="button"
														variant={
															session.id === activeSessionId
																? "secondary"
																: "ghost"
														}
														className="h-auto w-full min-w-0 justify-start px-2 py-1 text-left"
														onClick={() => void selectSession(session.id)}
													>
														<span className="min-w-0 truncate">
															{session.name || session.id.slice(0, 8)}
														</span>
													</Button>
												),
											},
											{
												key: "state",
												header: "State",
												cell: (session) => (
													<StatusBadge
														label={session.status}
														variant={statusVariant(session.status)}
													/>
												),
											},
											{
												key: "actions",
												header: "",
												cell: (session) => (
													<div className="flex justify-end gap-1">
														<ToolButton
															label={`Attach ${session.name || session.id}`}
															onClick={() => void selectSession(session.id)}
														>
															<Play className="h-4 w-4" />
														</ToolButton>
														<ToolButton
															label={`Close ${session.name || session.id}`}
															onClick={() => setPendingClose(session)}
														>
															<Trash2 className="h-4 w-4" />
														</ToolButton>
													</div>
												),
											},
										]}
									/>
								</div>
							)}
						</CardContent>
					</Card>

					<Card className="flex min-w-0 flex-col overflow-hidden">
						<CardHeader className="flex-row items-start justify-between gap-3 space-y-0 p-4">
							<div className="min-w-0">
								<CardTitle className="truncate text-sm">
									{activeSession
										? activeSession.name || activeSession.id
										: "Terminal"}
								</CardTitle>
								<p className="mt-1 truncate text-xs text-muted-foreground">
									{activeSession
										? `${activeSession.shell} · ${activeSession.cwd}`
										: "Attach or create a terminal session."}
								</p>
							</div>
							<div className="flex shrink-0 flex-wrap justify-end gap-2">
								{activeSession && (
									<>
										<StatusBadge
											label={activeSession.status}
											variant={statusVariant(activeSession.status)}
										/>
										<ToolButton
											label="Refresh terminal"
											onClick={() => void loadRender(activeSession.id)}
										>
											<RefreshCw className="h-4 w-4" />
										</ToolButton>
										<ToolButton
											label="Detach terminal"
											onClick={() => setActiveSessionId(null)}
										>
											<PanelLeftClose className="h-4 w-4" />
										</ToolButton>
									</>
								)}
							</div>
						</CardHeader>
						<CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
							{terminalError && (
								<ErrorState
									message={terminalError.message}
									details={terminalError.details}
								/>
							)}
							{notice && (
								<p className="text-xs text-muted-foreground" role="status">
									{notice}
								</p>
							)}
							{!activeSession ? (
								<EmptyState
									title="No session attached"
									description="Select a session or create a new shell."
									className="min-h-[320px]"
									action={
										<Button type="button" onClick={createSession}>
											<Plus className="mr-2 h-4 w-4" />
											New session
										</Button>
									}
								/>
							) : (
								<>
									<div className="flex flex-wrap items-center gap-2">
										<ToolButton
											label="Interrupt command"
											onClick={handleInterrupt}
										>
											<Square className="h-4 w-4" />
										</ToolButton>
										<ToolButton
											label="Copy terminal output"
											onClick={copyOutput}
										>
											<Copy className="h-4 w-4" />
										</ToolButton>
										<ToolButton
											label="Paste without Enter"
											onClick={pasteClipboard}
										>
											<ClipboardPaste className="h-4 w-4" />
										</ToolButton>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={clearOutput}
										>
											Clear
										</Button>
										<span className="ml-auto text-xs text-muted-foreground">
											{terminalSize.cols}x{terminalSize.rows}
											{activeView?.canAcceptInput === false ? " · busy" : ""}
										</span>
									</div>
									<div
										ref={viewportRef}
										className="min-h-[280px] flex-1 overflow-hidden rounded-md border border-border bg-zinc-950"
									>
										<div
											ref={outputRef}
											role="log"
											aria-label="Terminal output"
											className="h-full max-w-full overflow-auto p-3 font-mono text-[12px] leading-5 text-zinc-100"
										>
											{activeRows.length === 0 ? (
												<span className="text-zinc-500">
													Waiting for output...
												</span>
											) : (
												activeRows.map((row) => (
													<div
														key={`${activeSession.id}-${row.index}`}
														className="min-h-5 whitespace-pre-wrap break-words"
													>
														{renderRow(row)}
													</div>
												))
											)}
										</div>
									</div>
									<div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
										<Label
											htmlFor="terminal-command"
											className="truncate text-xs text-muted-foreground"
										>
											{activeSession.cwd || "~"}$
										</Label>
										<Input
											id="terminal-command"
											ref={inputRef}
											value={command}
											onChange={(event) => setCommand(event.target.value)}
											onKeyDown={handleKeyDown}
											placeholder="Enter command"
											aria-label="Terminal command"
										/>
										<Button
											type="button"
											onClick={sendCommand}
											disabled={!command.trim()}
											aria-label="Run terminal command"
										>
											<Play className="mr-2 h-4 w-4" />
											Run
										</Button>
									</div>
								</>
							)}
						</CardContent>
					</Card>

					<ConfirmDialog
						open={pendingClose !== null}
						onOpenChange={(open) => {
							if (!open) setPendingClose(null);
						}}
						title="Close Terminal Session"
						description={`Close ${pendingClose?.name || pendingClose?.id || "this session"} and stop its shell process.`}
						confirmLabel="Close"
						variant="destructive"
						onConfirm={() => {
							if (pendingClose) void closeSession(pendingClose);
						}}
					/>
					<ConfirmDialog
						open={pendingPaste !== null}
						onOpenChange={(open) => {
							if (!open) setPendingPaste(null);
						}}
						title="Paste Terminal Input"
						description="This paste contains multiline or destructive-looking input. Review before sending it to the terminal."
						confirmLabel="Paste"
						variant="destructive"
						onConfirm={() => {
							void confirmPendingPaste();
						}}
					/>
				</div>
			</TooltipProvider>
		</PageShell>
	);
}

function requiresPasteConfirmation(text: string): boolean {
	return (
		/[\r\n]/u.test(text) ||
		/\b(rm\s+-rf|del\s+\/[fsq]|format\s+[a-z]:|Remove-Item\s+-Recurse)\b/iu.test(
			text,
		)
	);
}
