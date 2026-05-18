import { useCallback, useEffect, useState } from "react";
import "./App.css";
import {
	CheckSquare,
	Globe,
	Home,
	Image,
	Menu,
	Monitor,
	Moon,
	Package,
	Repeat,
	Settings,
	Shield,
	Sun,
} from "lucide-react";
import { AppSidebar, type NavItem } from "@/components/layout/AppSidebar";
import { Toolbar } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { apiFetch } from "./api";
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

	if (!status) return { text: "Runtime starting", variant: "neutral" };

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
	const [error, setError] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(false);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		document.documentElement.classList.toggle("dark", theme === "dark");
		localStorage.setItem("bc-theme", theme);
	}, [theme]);

	useEffect(() => {
		localStorage.setItem("bc-page", page);
	}, [page]);

	useEffect(() => {
		const refresh = async () => {
			try {
				const data = await apiFetch<AppStatus>("/api/status");
				setStatus(data);
				setError(false);
			} catch (err) {
				console.error("Failed to fetch status", err);
				setError(true);
			} finally {
				setLoading(false);
			}
		};
		refresh();
		const timer = setInterval(refresh, 5000);
		return () => clearInterval(timer);
	}, []);

	const handleSelect = useCallback((id: string) => {
		setPage(id);
		setSidebarOpen(false);
	}, []);

	const health = getReadiness(status, error, loading);
	const policyLabel = status?.policyProfile
		? status.policyProfile.charAt(0).toUpperCase() +
			status.policyProfile.slice(1)
		: "Balanced";
	const browserLabel = status?.browser?.provider
		? status.browser.provider.charAt(0).toUpperCase() +
			status.browser.provider.slice(1)
		: "Not configured";

	const toolbarContext = (
		<div className="flex items-center gap-3 text-xs text-muted-foreground">
			<div className="flex items-center gap-1.5 px-3 py-1 rounded bg-muted/30 border border-border/20">
				<Monitor size={12} />
				Session: {browserLabel}
			</div>
			<div className="flex items-center gap-1.5 px-3 py-1 rounded bg-muted/30 border border-border/20">
				<Shield size={12} />
				Policy: {policyLabel}
			</div>
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
				<div
					className="sidebar-overlay"
					onClick={() => setSidebarOpen(false)}
					aria-hidden="true"
				/>
			)}

			<AppSidebar
				items={navConfig}
				active={page}
				onSelect={handleSelect}
				footer={sidebarFooter}
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
							{pageLabels[page] || "Browser Control"}
						</h1>
					</div>
					<div className="flex items-center gap-2">
						{/* Readiness pill */}
						<div
							className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${
								health.variant === "ok"
									? "bg-primary/10 text-primary"
									: health.variant === "warn"
										? "bg-amber-500/10 text-amber-600"
										: "bg-muted text-muted-foreground"
							}`}
						>
							<span
								className={`w-1.5 h-1.5 rounded-full ${
									health.variant === "ok"
										? "bg-primary"
										: health.variant === "warn"
											? "bg-amber-500"
											: "bg-muted-foreground"
								}`}
							/>
							{health.text}
						</div>
					</div>
				</Toolbar>

				<main className="flex-1 overflow-y-auto min-w-0">
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
				</main>
			</div>
		</div>
	);
}
