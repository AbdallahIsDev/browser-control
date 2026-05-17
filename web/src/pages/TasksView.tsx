import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { apiFetch } from "../api";
import type { Task } from "../types";

const STATUS_MAP: Record<string, "ok" | "warn" | "neutral" | "info"> = {
	running: "info",
	pending: "neutral",
	completed: "ok",
	failed: "warn",
};

export function TasksView() {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		apiFetch<Task[]>("/api/tasks")
			.then((data) => {
				setTasks(data);
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
			<PageShell>
				<ErrorState message="Error loading tasks" details={error} />
			</PageShell>
		);
	}

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				{tasks.length === 0 ? (
					<Card>
						<CardContent className="p-6">
							<EmptyState
								title="No tasks"
								description="Submit a task from the Command view to get started."
							/>
						</CardContent>
					</Card>
				) : (
					<Card>
						<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
							<CardTitle className="flex items-center gap-2">
								Tasks <Badge variant="secondary">{tasks.length}</Badge>
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>ID</TableHead>
											<TableHead>Prompt</TableHead>
											<TableHead>Status</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{tasks.map((t) => (
											<TableRow key={t.id}>
												<TableCell className="font-mono text-sm">
													{t.id}
												</TableCell>
												<TableCell className="max-w-[400px] truncate">
													{t.prompt}
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
						</CardContent>
					</Card>
				)}
			</div>
		</PageShell>
	);
}
