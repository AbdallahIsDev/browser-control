import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import {
	CheckSquare,
	Globe,
	Home,
	Image,
	KeyRound,
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
import { LockedDashboardScreen } from "@/components/layout/LockedDashboardScreen";
import { Toolbar } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiFetch, hasToken } from "./api";
import { isProductionFeatureEnabled } from "./featureFlags";
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
	{ id: "command", label: "Run Package", icon: <Home size={16} /> },
	{ id: "packages", label: "Package Library", icon: <Package size={16} /> },
	{ id: "workflows", label: "Workflows", icon: <Repeat size={16} /> },
	{ id: "browser", label: "Browser", icon: <Globe size={16} /> },
	{ id: "tasks", label: "Run History", icon: <CheckSquare size={16} /> },
	{ id: "evidence", label: "Evidence", icon: <Image size={16} /> },
	{ id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

const pageLabels: Record<string, string> = {
	command: "Run Package",
	terminal: "Terminal",
	tasks: "Run History",
	automations: "Automations",
	browser: "Browser",
	trading: "Trading",
	workflows: "Workflows",
	packages: "Package Library",
	evidence: "Evidence",
	settings: "Settings",
	advanced: "Advanced",
};

const pathToPage: Record<string, string> = {
	"/": "command",
	"/home": "command",
	"/tasks": "tasks",
	"/browser": "browser",
	"/workflows": "workflows",
	"/packages": "packages",
	"/evidence": "evidence",
	"/settings": "settings",
};

if (isProductionFeatureEnabled("trading")) {
	pathToPage["/trading"] = "trading";
}
if (isProductionFeatureEnabled("fullTerminalDashboard")) {
	pathToPage["/terminal"] = "terminal";
}
if (isProductionFeatureEnabled("advancedSurfaces")) {
	pathToPage["/advanced"] = "advanced";
	pathToPage["/automations"] = "automations";
}

const pageToPath = new Map(
	Object.entries(pathToPage).map(([routePath, pageId]) => [pageId, routePath]),
);

function pageFromLocation(): string | null {
	const routePage = pathToPage[window.location.pathname];
	if (routePage) return routePage;
	const stored = localStorage.getItem("bc-page");
	if (stored && stored in pageLabels) return stored;
	return null;
}

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
	if (loading) return { text: "Starting", variant: "neutral" };

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
		return { text: "Ready", variant: "ok" };
	if (status.health?.overall === "degraded")
		return { text: "Connection issue", variant: "warn" };
	if (status.health?.overall === "unhealthy")
		return { text: "Connection issue", variant: "warn" };

	if (daemonState === "stopped" && !brokerReachable)
		return { text: "App service offline", variant: "neutral" };

	if (daemonState === "running" || brokerReachable) {
		if (browserSessions === 0)
			return { text: "Browser disconnected", variant: "warn" };
		return { text: "Ready", variant: "ok" };
	}

	return { text: "Starting", variant: "neutral" };
}

export default function App() {
	const [page, setPage] = useState<string>(() => {
		return pageFromLocation() ?? "command";
	});
	const [theme, setTheme] = useState<"dark" | "light">(() => {
		const stored = localStorage.getItem("bc-theme");
		if (stored === "light" || stored === "dark") return stored;
		return window.matchMedia?.("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	});
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [authState, setAuthState] = useState<AuthState>(
		hasToken() ? "checking" : "no-token",
	);
	const [apiState, setApiState] = useState<ApiState>("ready");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
		return localStorage.getItem("bc-sidebar-collapsed") === "true";
	});
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		localStorage.setItem("bc-theme", theme);
	}, [theme]);

	useEffect(() => {
		localStorage.setItem("bc-page", page);
	}, [page]);

	useEffect(() => {
		const onPopState = () => setPage(pageFromLocation() ?? "command");
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		localStorage.setItem("bc-sidebar-collapsed", String(sidebarCollapsed));
	}, [sidebarCollapsed]);

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
		if (id === "trading" && !isProductionFeatureEnabled("trading")) return;
		if (
			id === "terminal" &&
			!isProductionFeatureEnabled("fullTerminalDashboard")
		)
			return;
		if (
			(id === "advanced" || id === "automations") &&
			!isProductionFeatureEnabled("advancedSurfaces")
		)
			return;
		setPage(id);
		const nextPath = pageToPath.get(id) ?? "/";
		if (window.location.pathname !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setSidebarOpen(false);
	}, []);

	const health = getReadiness(status, apiState !== "ready", loading);

	// Always derive provider/policy from live state or honest fallbacks.
	const policyLabel =
		status && apiState === "ready"
			? status.policyProfile
				? status.policyProfile.charAt(0).toUpperCase() +
					status.policyProfile.slice(1)
				: "Policy unknown"
			: apiState === "unavailable"
				? "Unavailable"
				: "Policy unknown";
	const activeProvider =
		status?.browser?.provider || (status ? status.provider?.active : undefined);
	const browserLabel =
		status && apiState === "ready"
			? activeProvider
				? activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)
				: "Provider unknown"
			: apiState === "unavailable"
				? "Unavailable"
				: "Provider unknown";

	const authVariant = AUTH_VARIANTS[authState];
	const authLabel = AUTH_LABELS[authState];

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
			<div
				className={`flex items-center gap-1.5 px-3 py-1 rounded bg-muted/30 border ${
					authVariant === "ok"
						? "border-primary/20"
						: authVariant === "warn"
							? "border-border/50"
							: "border-border/20"
				}`}
				role="status"
				aria-label="Authentication status"
			>
				<KeyRound size={12} />
				Auth: {authLabel}
				{storedTokenExists && (
					<button
						type="button"
						onClick={handleForgetToken}
						className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
						aria-label="Clear stored sign-in token"
						title="Clear stored sign-in token"
					>
						<LogOut size={10} />
						Sign out
					</button>
				)}
			</div>
			{authState !== "no-token" && (
				<>
					<div
						className={`flex items-center gap-1.5 px-3 py-1 rounded ${
							authState !== "authenticated"
								? "bg-muted/20 border-border/10 opacity-60 text-[10px]"
								: "bg-muted/30 border-border/20"
						} border`}
						role="status"
						aria-label="Browser provider status"
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
						role="status"
						aria-label="Policy profile status"
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
					<span>Open from CLI to sign in locally</span>
				</div>
			)}
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
						locked={false}
						collapsed={sidebarCollapsed}
						onToggleCollapsed={() =>
							setSidebarCollapsed((collapsed) => !collapsed)
						}
						className={`${sidebarOpen ? "open" : "hidden md:flex"}`}
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
							<LockedDashboardScreen />
						) : (
							<>
								{page === "command" && <CommandView />}
								{page === "terminal" &&
									isProductionFeatureEnabled("fullTerminalDashboard") && (
										<TerminalView />
									)}
								{page === "tasks" && <TasksView />}
								{page === "automations" &&
									isProductionFeatureEnabled("advancedSurfaces") && (
										<AutomationsView />
									)}
								{page === "browser" && <BrowserView />}
								{page === "trading" &&
									isProductionFeatureEnabled("trading") && <TradingView />}
								{page === "workflows" && <WorkflowsView />}
								{page === "packages" && <PackagesView />}
								{page === "evidence" && <EvidenceView />}
								{page === "settings" && <SettingsView />}
								{page === "advanced" &&
									isProductionFeatureEnabled("advancedSurfaces") && (
										<AdvancedView />
									)}
							</>
						)}
					</main>
				</div>
			</div>
		</TooltipProvider>
	);
}
