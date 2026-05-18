import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";
import type { Task, TaskListResponse } from "../types";

const STATUS_MAP: Record<string, "ok" | "warn" | "neutral" | "info"> = {
	running: "info",
	pending: "neutral",
	completed: "ok",
	failed: "warn",
};

export function TasksView() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [availability, setAvailability] = useState<TaskListResponse | null>(
		null,
	);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		apiFetch<Task[] | TaskListResponse>("/api/tasks")
			.then((data) => {
				const response = Array.isArray(data)
					? { tasks: data, available: true }
					: data;
				setTasks(response.tasks ?? []);
				setAvailability(response);
				setError("");
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
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
				<EmptyState
					title="Task runtime offline"
					description="Task progress, approvals, screenshots, and results will appear here."
				/>
			</PageShell>
		);
	}

	if (availability?.available === false) {
		const recovery =
			availability.recovery || "Start Browser Control daemon to monitor tasks.";
		return (
			<PageShell className="flex items-center justify-center min-h-[50vh]">
				<EmptyState title="Task runtime offline" description={recovery} />
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
					<div className="overflow-hidden border border-border rounded shadow-sm bg-card">
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
					</div>
				)}
			</div>
		</PageShell>
	);
}
