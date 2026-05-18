import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import {
	CheckSquare,
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

	const handleForgetToken = useCallback(() => {
		sessionStorage.removeItem("bc-token");
		window.location.reload();
	}, []);

	const storedTokenExists = hasToken();

	const toolbarContext = (
		<div className="flex items-center gap-3 text-xs text-muted-foreground">
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
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
					<Terminal size={12} />
					<span>
						Run{" "}
						<code className="bg-muted/60 px-1 py-0.5 rounded text-[11px] font-mono">
							bc web open
						</code>{" "}
						to get a tokenized URL
					</span>
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

			<AppSidebar
				items={navConfig}
				active={page}
				onSelect={handleSelect}
				footer={sidebarFooter}
				locked={authState === "no-token"}
				className={`${sidebarOpen ? "open fixed inset-y-0 left-0 md:relative" : "hidden md:flex"}`}
			/>

			<div className="flex-1 flex flex-col min-w-0 bg-background">
				<Toolbar context={toolbarContext}>
					<div className="flex items-center gap-3 min-w-0">
						<Button
							variant="ghost"
							size="icon"
							className="md:hidden shrink-0"
							onClick={() => setSidebarOpen(!sidebarOpen)}
							aria-label="Toggle navigation"
						>
							<Menu size={20} />
						</Button>
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
						<div className="flex items-center justify-center min-h-[70vh] px-6">
							<div className="max-w-md text-center space-y-6">
								<div className="space-y-3">
									<div className="mx-auto w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
										<Lock size={28} className="text-muted-foreground/60" />
									</div>
									<h2 className="text-2xl font-semibold tracking-tight">
										Local dashboard locked
									</h2>
									<p className="text-sm text-muted-foreground leading-relaxed">
										Open Browser Control from the CLI to get a one-time local
										token.
									</p>
								</div>
								<div className="space-y-2">
									<code className="block text-sm bg-muted/60 border border-border/50 px-4 py-2.5 rounded font-mono">
										bc web open
									</code>
									<p className="text-xs text-muted-foreground/60">
										Installed package:{" "}
										<code className="bg-muted/30 px-1 rounded font-mono">
											bc web open
										</code>
										<br />
										Source checkout:{" "}
										<code className="bg-muted/30 px-1 rounded font-mono">
											npm run cli -- web open
										</code>
										<br />
										Or open{" "}
										<code className="bg-muted/30 px-1 rounded font-mono">
											{window.location.origin}/#token=&lt;your-token&gt;
										</code>
									</p>
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
	);
}
