import { useEffect, useState } from "react";
import "./App.css";
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

type Page =
	| "command"
	| "terminal"
	| "tasks"
	| "automations"
	| "browser"
	| "trading"
	| "workflows"
	| "packages"
	| "evidence"
	| "settings"
	| "advanced";

export default function App() {
	const [page, setPage] = useState<Page>(
		(localStorage.getItem("bc-page") as Page) || "command",
	);
	const [theme, setTheme] = useState<"dark" | "light">(
		(localStorage.getItem("bc-theme") as "dark" | "light") || "dark",
	);
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(false);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
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
			} catch (err) {
				console.error("Failed to fetch status", err);
			}
		};
		refresh();
		const timer = setInterval(refresh, 5000);
		return () => clearInterval(timer);
	}, []);

	type NavItem = {
		id: Page;
		label: string;
		icon: string;
	};

	const navItems: NavItem[] = [
		{
			id: "command",
			label: "Command",
			icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
		},
		{
			id: "terminal",
			label: "Terminal",
			icon: "M4 6h16M4 12h16M4 18h12",
		},
		{
			id: "tasks",
			label: "Tasks",
			icon: "M9 11l3 3L22 4m-2 12.035V20a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h11.5",
		},
		{
			id: "automations",
			label: "Automations",
			icon: "M13 10V3L4 14h7v7l9-11h-7z",
		},
		{
			id: "browser",
			label: "Browser",
			icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9h18",
		},
		{
			id: "trading",
			label: "Trading",
			icon: "M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z",
		},
		{
			id: "workflows",
			label: "Workflows",
			icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
		},
		{
			id: "packages",
			label: "Packages",
			icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
		},
		{
			id: "evidence",
			label: "Evidence",
			icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
		},
		{
			id: "settings",
			label: "Settings",
			icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
		},
		{
			id: "advanced",
			label: "Advanced",
			icon: "M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z",
		},
	];

	return (
		<div className="premium-app-container sidebar-layout">
			{sidebarOpen && (
				<button
					type="button"
					className="sidebar-backdrop"
					onClick={() => setSidebarOpen(false)}
					aria-label="Close sidebar"
				/>
			)}
			<aside className={`app-sidebar ${sidebarOpen ? "open" : ""}`}>
				<div className="sidebar-brand">
					<div className="brand-icon">BC</div>
					<div className="brand-text">Browser Control</div>
				</div>

				<nav className="sidebar-nav">
					{navItems.map((item) => (
						<button
							type="button"
							key={item.id}
							className={`nav-item ${page === item.id ? "active" : ""}`}
							onClick={() => {
								setPage(item.id);
								setSidebarOpen(false);
							}}
						>
							<svg
								className="nav-icon"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
								focusable="false"
							>
								<path d={item.icon} />
							</svg>
							<span className="nav-label">{item.label}</span>
						</button>
					))}
				</nav>

				<div className="sidebar-footer">
					<div className="status-group">
						<StatusIndicator
							label="Agent"
							value={status?.broker?.reachable ? "Online" : "Offline"}
							ok={status?.broker?.reachable ?? false}
						/>
						<StatusIndicator
							label="Daemon"
							value={status?.daemon?.state || "Unknown"}
							ok={status?.daemon?.state === "running"}
						/>
					</div>
					<button
						type="button"
						className="theme-toggle-btn"
						onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
					>
						{theme === "dark" ? "Light Mode" : "Dark Mode"}
					</button>
				</div>
			</aside>

			<div className="workspace-main">
				<header className="workspace-header">
					<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
						<button
							type="button"
							className="sidebar-toggle"
							onClick={() => setSidebarOpen(!sidebarOpen)}
							aria-label="Toggle navigation"
						>
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
								focusable="false"
							>
								<line x1="3" y1="12" x2="21" y2="12" />
								<line x1="3" y1="6" x2="21" y2="6" />
								<line x1="3" y1="18" x2="21" y2="18" />
							</svg>
						</button>
						<div className="header-page-title">
							{navItems.find((i) => i.id === page)?.label}
						</div>
					</div>
					<div className="header-metrics">
						<div className="metric-item">
							<span className="metric-label">Health</span>
							<span
								className={
									status?.health?.overall === "healthy"
										? "status-ok"
										: "status-warn"
								}
							>
								{status?.health?.overall || "Unknown"}
							</span>
						</div>
					</div>
				</header>

				<main className="workspace-content animate-fade-in">
					{page === "command" && <CommandView />}
					{page === "terminal" && <TerminalView />}
					{page === "tasks" && <TasksView />}
					{page === "automations" && <AutomationsView />}
					{page === "browser" && <BrowserView />}
					{page === "trading" && <TradingView />}
					{page === "workflows" && <WorkflowsView />}
					{page === "packages" && <PackagesView />}
					{page === "evidence" && <EvidenceView />}
					{page === "settings" && <SettingsView />}
					{page === "advanced" && <AdvancedView />}
				</main>
			</div>
		</div>
	);
}

function StatusIndicator({
	label,
	value,
	ok,
}: {
	label: string;
	value: string;
	ok: boolean;
}) {
	return (
		<div className="status-item">
			<span className="status-label">{label}:</span>
			<span className={`status-value ${ok ? "status-ok" : "status-warn"}`}>
				{value}
			</span>
		</div>
	);
}
