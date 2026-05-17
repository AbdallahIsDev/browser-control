import { ArrowRight, Monitor, Paperclip, Shield } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "../api";
import type { AppStatus, Task, TaskListResponse } from "../types";

const STATUS_MAP: Record<string, "ok" | "warn" | "neutral" | "info"> = {
	running: "info",
	pending: "neutral",
	completed: "ok",
	failed: "warn",
};

const SUGGESTIONS = [
	{
		label: "Research a website",
		prompt:
			"Research the website at [URL] and summarize key information including products, pricing, and contact details.",
	},
	{
		label: "Fill a form",
		prompt: "Fill out the form at [URL] with the following information: ",
	},
	{
		label: "Extract data",
		prompt: "Extract data from [URL] regarding [topic].",
	},
	{
		label: "Upload content",
		prompt:
			"Upload the file [file path] to [destination URL] and verify the upload was successful.",
	},
	{
		label: "Monitor a page",
		prompt: "Monitor the page at [URL] and notify me when [condition] changes.",
	},
	{ label: "Run workflow", prompt: "Run the workflow to " },
];

export function CommandView() {
	const [prompt, setPrompt] = useState("");
	const [notice, setNotice] = useState("");
	const [allTasks, setAllTasks] = useState<Task[]>([]);
	const [status, setStatus] = useState<AppStatus | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const loadTasks = useCallback(async () => {
		try {
			const response = await apiFetch<Task[] | TaskListResponse>("/api/tasks");
			setAllTasks(Array.isArray(response) ? response : (response.tasks ?? []));
		} catch {
			// ignore
		}
	}, []);

	const loadStatus = useCallback(async () => {
		try {
			const data = await apiFetch<AppStatus>("/api/status");
			setStatus(data);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		loadTasks();
		loadStatus();
		const timer = setInterval(() => {
			loadTasks();
			loadStatus();
		}, 5000);
		return () => clearInterval(timer);
	}, [loadTasks, loadStatus]);

	const handleRun = async () => {
		if (!prompt) return;
		setNotice("Starting task...");
		try {
			await apiFetch("/api/tasks", {
				method: "POST",
				body: JSON.stringify({ prompt, action: prompt.slice(0, 48) }),
			});
			setNotice("Task started.");
			setPrompt("");
			await loadTasks();
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
					description: "Saved from Home",
					category: "General",
					prompt,
					approvalRequired: true,
				}),
			});
			setNotice("Automation saved.");
		} catch (err: unknown) {
			setNotice(`Error: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			e.preventDefault();
			handleRun();
		}
	};

	const handleSuggestion = (suggestionPrompt: string) => {
		setPrompt(suggestionPrompt);
		textareaRef.current?.focus();
	};

	const runningTasks = allTasks.filter(
		(t) => t.status === "running" || t.status === "pending",
	);
	const recentTasks = allTasks
		.filter((t) => t.status === "completed" || t.status === "failed")
		.slice(0, 5);

	const policyLabel = status?.policyProfile
		? status.policyProfile.charAt(0).toUpperCase() +
			status.policyProfile.slice(1)
		: "Balanced";
	const browserLabel = status?.browser?.provider
		? status.browser.provider.charAt(0).toUpperCase() +
			status.browser.provider.slice(1)
		: "Not configured";

	return (
		<PageShell className="flex items-start justify-center">
			<div className="w-full max-w-[960px] space-y-8 py-10 md:py-16">
				{/* Headline */}
				<div className="text-center space-y-3">
					<h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
						What should your agent do?
					</h2>
				</div>

				{/* Notice */}
				{notice && (
					<div className="flex justify-center">
						<Badge variant="secondary" className="w-fit text-xs">
							{notice}
						</Badge>
					</div>
				)}

				{/* Context status row */}
				<div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
					<div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted/20 border border-border/20">
						<Monitor size={12} />
						Session: {browserLabel}
					</div>
					<div className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted/20 border border-border/20">
						<Shield size={12} />
						Policy: {policyLabel}
					</div>
				</div>

				{/* Prompt composer */}
				<div className="relative border border-border/50 rounded-lg shadow-xs bg-muted">
					<Textarea
						ref={textareaRef}
						placeholder="Ask Browser Control to research a website, fill a form, upload content, monitor a page, or run a workflow..."
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={handleKeyDown}
						className="min-h-[140px] md:min-h-[120px] text-[15px] leading-relaxed resize-none !bg-transparent border-0 p-4 focus-visible:ring-0 placeholder:text-muted-foreground/60"
					/>

					{/* Action row */}
					<div className="flex items-center justify-between p-2 gap-2">
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
							aria-label="Attach file"
						>
							<Paperclip size={16} />
						</Button>

						<div className="flex items-center gap-2">
							{prompt && (
								<Button
									variant="ghost"
									size="sm"
									onClick={handleSaveAutomation}
									className="h-8 px-3 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
								>
									Save as workflow
								</Button>
							)}
							<Button
								onClick={handleRun}
								disabled={!prompt}
								size="icon"
								className="h-8 w-8"
								aria-label="Run task"
							>
								<ArrowRight size={16} />
							</Button>
						</div>
					</div>
				</div>

				{/* Suggestion chips */}
				<div className="flex flex-wrap gap-2 justify-center pt-2">
					{SUGGESTIONS.map((s) => (
						<Button
							key={s.label}
							type="button"
							variant="outline"
							size="sm"
							onClick={() => handleSuggestion(s.prompt)}
							className="h-9 px-4 rounded text-xs font-medium text-muted-foreground bg-background hover:bg-muted/50 border-border/75!"
						>
							{s.label}
						</Button>
					))}
				</div>

				{/* Activity section */}
				<div className="space-y-6 pt-8">
					{runningTasks.length === 0 && recentTasks.length === 0 ? (
						<EmptyState
							title="No tasks running"
							description="Task progress, approvals, screenshots, and results will appear here."
						/>
					) : (
						<div className="space-y-8">
							{runningTasks.length > 0 && (
								<div className="space-y-3">
									<h3 className="text-sm font-semibold text-foreground">
										Running now
									</h3>
									<div className="space-y-2">
										{runningTasks.slice(0, 5).map((t) => (
											<div
												key={t.id}
												className="flex items-center justify-between gap-3 rounded border border-border/40 bg-card/40 px-3 py-2.5"
											>
												<div className="flex items-center gap-2.5 min-w-0">
													<StatusBadge
														label={t.status}
														variant={STATUS_MAP[t.status] || "neutral"}
													/>
													<span className="truncate text-sm">
														{t.prompt || t.id}
													</span>
												</div>
												<span className="text-xs font-mono text-muted-foreground shrink-0">
													{t.id.slice(0, 8)}
												</span>
											</div>
										))}
									</div>
								</div>
							)}
							{recentTasks.length > 0 && (
								<div className="space-y-3">
									<h3 className="text-sm font-semibold text-foreground">
										Recent tasks
									</h3>
									<div className="space-y-2">
										{recentTasks.map((t) => (
											<div
												key={t.id}
												className="flex items-center justify-between gap-3 rounded border border-border/40 bg-card/40 px-3 py-2.5"
											>
												<div className="flex items-center gap-2.5 min-w-0">
													<StatusBadge
														label={t.status}
														variant={STATUS_MAP[t.status] || "neutral"}
													/>
													<span className="truncate text-sm">
														{t.prompt || t.id}
													</span>
												</div>
												<span className="text-xs font-mono text-muted-foreground shrink-0">
													{t.id.slice(0, 8)}
												</span>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</PageShell>
	);
}
