import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ApiFetchError, apiFetch } from "../api";
import type { ApiErrorBody, Task, TaskListResponse } from "../types";

const TASKS_POLL_MS = 5000;

const STATUS_MAP: Record<string, "ok" | "warn" | "neutral" | "info"> = {
	running: "info",
	pending: "neutral",
	completed: "ok",
	failed: "warn",
};

function taskAvailabilityFromError(error: unknown): TaskListResponse | null {
	if (!(error instanceof ApiFetchError)) return null;
	const body = error.body as ApiErrorBody | undefined;
	if (body?.code !== "capability_unavailable") return null;
	const details =
		body.details && typeof body.details === "object"
			? (body.details as Partial<TaskListResponse>)
			: {};
	return {
		tasks: Array.isArray(details.tasks) ? details.tasks : [],
		available: false,
		code: body.code,
		error: body.error,
		recovery:
			typeof details.recovery === "string" ? details.recovery : undefined,
	};
}

export function TasksView() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [availability, setAvailability] = useState<TaskListResponse | null>(
		null,
	);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		let firstLoad = true;

		const loadTasks = () => {
			if (document.hidden) return;
			if (firstLoad) setLoading(true);
			apiFetch<Task[] | TaskListResponse>("/api/tasks")
				.then((data) => {
					if (cancelled) return;
					const response = Array.isArray(data)
						? { tasks: data, available: true }
						: data;
					setTasks(response.tasks ?? []);
					setAvailability(response);
					setError("");
				})
				.catch((err: unknown) => {
					if (cancelled) return;
					const unavailable = taskAvailabilityFromError(err);
					if (unavailable) {
						setTasks([]);
						setAvailability(unavailable);
						setError("");
						return;
					}
					setError(err instanceof Error ? err.message : String(err));
				})
				.finally(() => {
					if (cancelled) return;
					firstLoad = false;
					setLoading(false);
				});
		};

		loadTasks();
		const interval = window.setInterval(loadTasks, TASKS_POLL_MS);
		document.addEventListener("visibilitychange", loadTasks);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
			document.removeEventListener("visibilitychange", loadTasks);
		};
	}, []);

	if (loading) {
		return (
			<PageShell>
				<LoadingState message="Loading tasks..." />
			</PageShell>
		);
	}

	if (error) {
		return (
			<PageShell className="flex items-center justify-center min-h-[50vh]">
				<ErrorState
					message="Task service offline"
					details="Task progress, approvals, screenshots, and results will appear here."
				/>
			</PageShell>
		);
	}

	if (availability?.available === false) {
		const recovery =
			availability.recovery ||
			"Start Browser Control app service to monitor tasks.";
		return (
			<PageShell className="flex items-center justify-center min-h-[50vh]">
				<EmptyState
					title="Task service offline"
					description={`${recovery} Task history will load automatically.`}
				/>
			</PageShell>
		);
	}

	return (
		<PageShell>
			<div className="space-y-6">
				<h2 className="text-2xl font-semibold">Tasks</h2>
				{tasks.length === 0 ? (
					<EmptyState
						title="No tasks running"
						description="Task progress, approvals, screenshots, and results will appear here."
					/>
				) : (
					<Card>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Task</TableHead>
										<TableHead className="w-[120px]">Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{tasks.map((t) => (
										<TableRow key={t.id}>
											<TableCell className="max-w-[600px] truncate">
												{t.prompt || t.id}
											</TableCell>
											<TableCell>
												<StatusBadge
													label={t.status}
													variant={STATUS_MAP[t.status] || "neutral"}
												/>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				)}
			</div>
		</PageShell>
	);
}
