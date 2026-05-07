/**
 * Terminal Types — Core interfaces for the native terminal automation layer.
 *
 * These types define the Browser Control-native terminal abstraction that
 * Section 5 (Action Surface), Section 7 (MCP), and Section 13 (Terminal Resume)
 * will build on.
 */

// ── Execution Options ────────────────────────────────────────────────

export interface ExecOptions {
	/** Override working directory for this command. */
	cwd?: string;
	/** Additional environment variables merged into the session env. */
	env?: Record<string, string>;
	/** Timeout in milliseconds. 0 or undefined = no timeout. */
	timeoutMs?: number;
	/** Run in background and return immediately. */
	background?: boolean;
	/** Max output bytes to capture (default: 1MB). */
	maxOutputBytes?: number;
}

// ── Execution Result ─────────────────────────────────────────────────

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	cwd: string;
	timedOut: boolean;
}

// ── Terminal Session Config ──────────────────────────────────────────

export interface TerminalSessionConfig {
	/** Shell to spawn ("bash", "sh", "pwsh"). On Windows, "powershell" aliases to "pwsh" when available. Auto-detected if omitted. */
	shell?: string;
	/** Working directory. Defaults to process.cwd(). */
	cwd?: string;
	/** Environment variables. Merged with process.env if provided. */
	env?: Record<string, string>;
	/** Terminal columns (default: 80). */
	cols?: number;
	/** Terminal rows (default: 24). */
	rows?: number;
	/** Human-readable session name for listing. */
	name?: string;
	/**
	 * Optional explicit logical session id.
	 * Used during resume to preserve the same session identity across
	 * daemon restarts. If omitted, a new UUID is generated.
	 */
	id?: string;
}

// ── Terminal Snapshot ────────────────────────────────────────────────

export interface TerminalSnapshot {
	sessionId: string;
	name?: string;
	shell: string;
	cwd: string;
	env: Record<string, string>;
	status: "idle" | "running" | "interrupted" | "closed";
	lastOutput: string;
	promptDetected: boolean;
	scrollbackLines: number;
	runningCommand?: string;
	createdAt: string;
	lastActivityAt: string;
	/** Resume metadata if this session was restored from persisted state. */
	resumeMetadata?: {
		restored: boolean;
		resumeLevel?: 1 | 2;
		status?: "fresh" | "resumed" | "reconstructed";
		preserved?: { metadata: boolean; buffer: boolean };
		lost?: string[];
		priorStatus?: "idle" | "running" | "interrupted" | "closed";
		priorRunningCommand?: string;
		originalCreatedAt?: string;
		reconstructedAt?: string;
	};
}

// ── Terminal Session Status ──────────────────────────────────────────

export type TerminalSessionStatus =
	| "idle"
	| "running"
	| "interrupted"
	| "closed";

// ── Terminal Session (public interface) ──────────────────────────────

export interface TerminalSession {
	readonly id: string;
	readonly name: string | undefined;
	readonly shell: string;
	cwd: string;
	readonly env: Record<string, string>;
	readonly status: TerminalSessionStatus;
	readonly createdAt: string;

	/** Run a command and wait for completion. */
	exec(command: string, options?: ExecOptions): Promise<ExecResult>;

	/** Write raw data to the session stdin. Appends newline automatically. */
	write(data: string): Promise<void>;

	/** Read recent output from the session. */
	read(maxBytes?: number): Promise<string>;

	/** Capture a full snapshot of the session state. */
	snapshot(): Promise<TerminalSnapshot>;

	/** Send SIGINT (Ctrl+C) to interrupt a running command. */
	interrupt(): Promise<void>;

	/** Resize the terminal (cols, rows). */
	resize(cols: number, rows: number): Promise<void>;

	/** Close the session and kill the PTY process. */
	close(): Promise<void>;

	/** Subscribe to raw output data from the terminal. */
	onData(listener: (data: string) => void): { dispose(): void };

	/** Resume metadata if this session was reconstructed from persisted state. */
	resumeMetadata?: TerminalSnapshot["resumeMetadata"];
}

// ── Session Manager (public interface) ───────────────────────────────

export interface TerminalSessionManager {
	/** Create a new terminal session. */
	create(config?: TerminalSessionConfig): Promise<TerminalSession>;

	/** Get a session by ID. */
	get(sessionId: string): TerminalSession | undefined;

	/** List all active sessions. */
	list(): TerminalSession[];

	/** Close a session by ID. */
	close(sessionId: string): Promise<void>;

	/** Close all sessions. */
	closeAll(): Promise<void>;

	/** Subscribe to raw output data from all sessions. */
	onData(listener: (sessionId: string, data: string) => void): {
		dispose(): void;
	};
}
