import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import {
	Check,
	CheckSquare,
	Copy,
	Globe,
	Home,
	Image,
	KeyRound,
	Lock,
	LogOut,
	Menu,
	Monitor,
	Moon,
	Package,
	Repeat,
	Settings,
	Shield,
	Sun,
	Terminal,
} from "lucide-react";
import { AppSidebar, type NavItem } from "@/components/layout/AppSidebar";
import { Toolbar } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiFetch, hasToken } from "./api";
import {
	AdvancedView,
	AutomationsView,
	BrowserView,
	CommandView,
	EvidenceView,
	PackagesView,
	SettingsView,
	TasksView,
	TerminalView,
	TradingView,
	WorkflowsView,
} from "./pages";
import type { AppStatus } from "./types";

type AuthState =
	| "authenticated"
	| "unauthorized"
	| "no-token"
	| "checking"
	| "api-error";
type ApiState = "ready" | "unavailable";

const AUTH_LABELS: Record<AuthState, string> = {
	authenticated: "Signed in",
	unauthorized: "Unauthorized",
	"no-token": "Sign-in required",
	checking: "Checking...",
	"api-error": "API unavailable",
};

const AUTH_VARIANTS: Record<AuthState, "ok" | "warn" | "neutral"> = {
	authenticated: "ok",
	unauthorized: "warn",
	"no-token": "neutral",
	checking: "neutral",
	"api-error": "warn",
};

const navConfig: NavItem[] = [
	{ id: "command", label: "Home", icon: <Home size={16} /> },
	{ id: "tasks", label: "Tasks", icon: <CheckSquare size={16} /> },
	{ id: "browser", label: "Browser", icon: <Globe size={16} /> },
	{ id: "workflows", label: "Workflows", icon: <Repeat size={16} /> },
	{ id: "packages", label: "Skills", icon: <Package size={16} /> },
	{ id: "evidence", label: "Evidence", icon: <Image size={16} /> },
	{ id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

const pageLabels: Record<string, string> = {
	command: "Home",
	terminal: "Terminal",
	tasks: "Tasks",
	automations: "Automations",
	browser: "Browser",
	trading: "Trading",
	workflows: "Workflows",
	packages: "Skills",
	evidence: "Evidence",
	settings: "Settings",
	advanced: "Advanced",
};

/** Map status to a human-readable readiness state */
function getReadiness(
	status: AppStatus | null,
	error: boolean,
	loading: boolean,
): {
	text: string;
	variant: "ok" | "warn" | "neutral";
} {
	if (error) return { text: "API unavailable", variant: "warn" };
	if (loading) return { text: "Runtime starting", variant: "neutral" };

	// No status and not loading — show context-appropriate label
	if (!status) {
		if (!hasToken()) {
			return { text: "Not signed in", variant: "neutral" };
		}
		return { text: "No runtime info", variant: "neutral" };
	}

	const daemonState = status.daemon?.state;
	const brokerReachable = status.broker?.reachable === true;
	const browserSessions = Number(status.browser?.activeSessions ?? 0);

	if (status.health?.overall === "healthy")
		return { text: "Runtime ready", variant: "ok" };
	if (status.health?.overall === "degraded")
		return { text: "Runtime degraded", variant: "warn" };
	if (status.health?.overall === "unhealthy")
		return { text: "Runtime degraded", variant: "warn" };

	if (daemonState === "stopped" && !brokerReachable)
		return { text: "Runtime offline", variant: "neutral" };

	if (daemonState === "running" || brokerReachable) {
		if (browserSessions === 0)
			return { text: "Browser disconnected", variant: "warn" };
		return { text: "Runtime ready", variant: "ok" };
	}

	return { text: "Runtime starting", variant: "neutral" };
}

function CommandCopyCard({
	command,
	label,
	description,
	ariaLabel,
	compact = false,
}: {
	command: string;
	label: string;
	description: string;
	ariaLabel: string;
	compact?: boolean;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(command);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}, [command]);

	return (
		<button
			type="button"
			onClick={() => {
				void handleCopy();
			}}
			className={`w-full rounded-2xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
				compact
					? "bg-muted/35 border-border/50 px-4 py-3 hover:bg-muted/55"
					: "bg-card border-border/60 px-5 py-4 hover:bg-card/90"
			}`}
			aria-label={ariaLabel}
		>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 space-y-1">
					<p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
						{label}
					</p>
					<code className="block overflow-x-auto text-sm font-semibold text-foreground">
						{command}
					</code>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
				<div className="shrink-0 rounded-full border border-border/60 bg-background/80 p-2 text-muted-foreground">
					{copied ? <Check size={16} /> : <Copy size={16} />}
				</div>
			</div>
			<div
				className={`mt-3 text-xs font-medium ${
					copied ? "text-primary" : "text-muted-foreground/70"
				}`}
				aria-live="polite"
			>
				{copied ? "Copied" : "Click anywhere to copy"}
			</div>
		</button>
	);
}

export default function App() {
	const [page, setPage] = useState<string>(() => {
		const stored = localStorage.getItem("bc-page");
		if (stored && stored in pageLabels) return stored;
		return "command";
	});
	const [theme, setTheme] = useState<"dark" | "light">(() => {
		const stored = localStorage.getItem("bc-theme");
		return stored === "light" || stored === "dark" ? stored : "dark";
	});
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [authState, setAuthState] = useState<AuthState>(
		hasToken() ? "checking" : "no-token",
	);
	const [apiState, setApiState] = useState<ApiState>("ready");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		localStorage.setItem("bc-theme", theme);
	}, [theme]);

	useEffect(() => {
		localStorage.setItem("bc-page", page);
	}, [page]);

	useEffect(() => {
		// Don't poll if no token is present
		const shouldPoll = hasToken();

		const refresh = async () => {
			try {
				const data = await apiFetch<AppStatus>("/api/status");
				setStatus(data);
				setApiState("ready");
				setAuthState("authenticated");
			} catch (err) {
				console.error("Failed to fetch status", err);
				// Clear stale status — don't keep old provider/policy visible
				setStatus(null);
				setApiState("unavailable");
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes("Unauthorized") || message.includes("401")) {
					setAuthState("unauthorized");
				} else if (hasToken()) {
					// Token present but API unreachable — show "API unavailable", not "Sign-in required"
					setAuthState("api-error");
				} else {
					setAuthState("no-token");
				}
			} finally {
				setLoading(false);
			}
		};

		if (shouldPoll) {
			refresh();
			pollingRef.current = setInterval(refresh, 5000);
		} else {
			setLoading(false);
		}

		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
				pollingRef.current = null;
			}
		};
	}, []);

	const handleSelect = useCallback((id: string) => {
		setPage(id);
		setSidebarOpen(false);
	}, []);

	const health = getReadiness(status, apiState !== "ready", loading);

	// Always derive provider/policy — use status when live, fallback labels otherwise
	const policyLabel =
		status && apiState === "ready"
			? status.policyProfile
				? status.policyProfile.charAt(0).toUpperCase() +
					status.policyProfile.slice(1)
				: "Balanced"
			: apiState === "unavailable"
				? "Unavailable"
				: "—";
	const browserLabel =
		status && apiState === "ready"
			? status.browser?.provider
				? status.browser.provider.charAt(0).toUpperCase() +
					status.browser.provider.slice(1)
				: "Not configured"
			: apiState === "unavailable"
				? "Unavailable"
				: "—";

	const authVariant = AUTH_VARIANTS[authState];
	const authLabel = AUTH_LABELS[authState];
	const noTokenSourceCommand = "npm run cli -- web open";

	const handleForgetToken = useCallback(() => {
		sessionStorage.removeItem("bc-token");
		window.location.reload();
	}, []);

	const storedTokenExists = hasToken();

	const toolbarContext = (
		<div className="flex items-center gap-3 text-xs text-muted-foreground">
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
							aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
						>
							{theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
						</Button>
					}
				/>
				<TooltipContent>
					{theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
				</TooltipContent>
			</Tooltip>
			{/* Auth pill — always visible */}
			<div
				className={`flex items-center gap-1.5 px-3 py-1 rounded bg-muted/30 border ${
					authVariant === "ok"
						? "border-primary/20"
						: authVariant === "warn"
							? "border-border/50"
							: "border-border/20"
				}`}
			>
				<KeyRound size={12} />
				Auth: {authLabel}
				{/* Forget button — only when there is a stored token to clear */}
				{storedTokenExists && (
					<button
						type="button"
						onClick={handleForgetToken}
						className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
						aria-label="Clear stored session token"
					>
						<LogOut size={10} />
						Forget
					</button>
				)}
			</div>
			{/* Provider & Policy pills — hidden when no token exists */}
			{authState !== "no-token" && (
				<>
					<div
						className={`flex items-center gap-1.5 px-3 py-1 rounded ${
							authState !== "authenticated"
								? "bg-muted/20 border-border/10 opacity-60 text-[10px]"
								: "bg-muted/30 border-border/20"
						} border`}
					>
						<Monitor size={12} />
						Provider: {browserLabel}
					</div>
					<div
						className={`flex items-center gap-1.5 px-3 py-1 rounded ${
							authState !== "authenticated"
								? "bg-muted/20 border-border/10 opacity-60 text-[10px]"
								: "bg-muted/30 border-border/20"
						} border`}
					>
						<Shield size={12} />
						Policy: {policyLabel}
					</div>
				</>
			)}
			{/* Hint for no-token state */}
			{authState === "no-token" && (
				<div className="flex items-center gap-2 rounded-full border border-border/40 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
					<Terminal size={12} />
					<span>Open from CLI for a one-time local token</span>
				</div>
			)}
		</div>
	);

	const sidebarFooter = (
		<div className="space-y-3">
			<Button
				variant="ghost"
				size="sm"
				className="w-full justify-start gap-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
				onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
				aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
			>
				{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
				{theme === "dark" ? "Light Mode" : "Dark Mode"}
			</Button>
		</div>
	);

	return (
		<TooltipProvider>
			<div className="premium-app-container sidebar-layout">
				{/* Mobile sidebar overlay backdrop */}
				{sidebarOpen && (
					<button
						type="button"
						className="sidebar-overlay"
						onClick={() => setSidebarOpen(false)}
						aria-label="Close navigation"
					/>
				)}

				{authState !== "no-token" && (
					<AppSidebar
						items={navConfig}
						active={page}
						onSelect={handleSelect}
						footer={sidebarFooter}
						locked={false}
						className={`${sidebarOpen ? "open fixed inset-y-0 left-0 md:relative" : "hidden md:flex"}`}
					/>
				)}

				<div className="flex-1 flex flex-col min-w-0 bg-background">
					<Toolbar context={toolbarContext}>
						<div className="flex items-center gap-3 min-w-0">
							{authState !== "no-token" && (
								<Button
									variant="ghost"
									size="icon"
									className="md:hidden shrink-0"
									onClick={() => setSidebarOpen(!sidebarOpen)}
									aria-label="Toggle navigation"
								>
									<Menu size={20} />
								</Button>
							)}
							<h1 className="text-sm md:text-base font-semibold truncate">
								{authState === "no-token"
									? "Locked dashboard"
									: pageLabels[page] || "Browser Control"}
							</h1>
						</div>
						<div className="flex items-center gap-2" role="status">
							{/* Readiness pill */}
							<div
								className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${
									health.variant === "ok"
										? "bg-primary/10 text-primary"
										: health.variant === "warn"
											? "bg-muted/80 text-muted-foreground"
											: "bg-muted text-muted-foreground"
								}`}
							>
								<span
									className={`w-1.5 h-1.5 rounded-full ${
										health.variant === "ok"
											? "bg-primary"
											: health.variant === "warn"
												? "bg-muted-foreground"
												: "bg-muted-foreground"
									}`}
								/>
								{health.text}
							</div>
						</div>
					</Toolbar>

					<main className="flex-1 overflow-y-auto min-w-0">
						{authState === "no-token" ? (
							<div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-5 py-10 md:min-h-[calc(100vh-4rem)] md:px-8">
								<div className="w-full max-w-3xl rounded-[28px] border border-border/60 bg-card/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.18)] backdrop-blur md:p-10">
									<div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
										<div className="space-y-5">
											<div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/40">
												<Lock size={28} className="text-muted-foreground/70" />
											</div>
											<div className="space-y-3">
												<p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">
													Auth required
												</p>
												<h2 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
													Local dashboard locked
												</h2>
												<p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
													Open the dashboard from the CLI to mint a one-time
													local tokenized URL. Bare URLs without a token stay
													locked by design.
												</p>
											</div>
											<div className="grid gap-3">
												<CommandCopyCard
													command="bc web open"
													label="Installed command"
													description="Starts the local dashboard and opens a one-time tokenized URL."
													ariaLabel="Copy bc web open command"
												/>
												<CommandCopyCard
													command="bc web open --port=0"
													label="Port-busy fallback"
													description="Use this when port 7790 is already taken by another process."
													ariaLabel="Copy bc web open --port=0 command"
													compact
												/>
												<CommandCopyCard
													command={noTokenSourceCommand}
													label="Source checkout"
													description="Use this inside the repo when running Browser Control from source."
													ariaLabel="Copy source checkout web open command"
													compact
												/>
											</div>
										</div>
										<div className="space-y-4 rounded-3xl border border-border/50 bg-background/70 p-5">
											<h3 className="text-sm font-semibold tracking-tight text-foreground">
												If the page stays locked
											</h3>
											<div className="space-y-3 text-sm text-muted-foreground">
												<p>
													1. Run{" "}
													<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
														bc web open
													</code>
													.
												</p>
												<p>
													2. If port 7790 is busy, use{" "}
													<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
														bc web open --port=0
													</code>
													.
												</p>
												<p>
													3. From source, use{" "}
													<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
														{noTokenSourceCommand}
													</code>
													.
												</p>
											</div>
											<div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
												Valid token URLs look like{" "}
												<code className="font-mono">
													{window.location.origin}/#token=&lt;one-time-token&gt;
												</code>
												.
											</div>
										</div>
									</div>
								</div>
							</div>
						) : (
							<>
								{page === "command" && <CommandView />}
								{page === "terminal" && <TerminalView />}
								{page === "tasks" && <TasksView />}
								{page === "automations" && <AutomationsView />}
								{page === "browser" && <BrowserView />}
								{page === "trading" && <TradingView />}
								{page === "workflows" && <WorkflowsView />}
								{page === "packages" && (
									<PackagesView onOpenTrading={() => handleSelect("trading")} />
								)}
								{page === "evidence" && <EvidenceView />}
								{page === "settings" && <SettingsView />}
								{page === "advanced" && <AdvancedView />}
							</>
						)}
					</main>
				</div>
			</div>
		</TooltipProvider>
	);
}
