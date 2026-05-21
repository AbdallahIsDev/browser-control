import { useEffect, useState } from "react";
import { DataTable } from "@/components/common/DataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "../api";
import type { Automation } from "../types";

function summarizePrompt(prompt: string) {
	const trimmed = prompt.trim();
	if (!trimmed) return "No instructions saved.";
	return trimmed.length > 90 ? `${trimmed.slice(0, 87)}...` : trimmed;
}

export function AutomationsView() {
	const [automations, setAutomations] = useState<Automation[]>([]);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		apiFetch<Automation[]>("/api/saved-automations")
			.then((items) => {
				setAutomations(items);
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
				<LoadingState message="Loading automations..." />
			</PageShell>
		);
	}

	if (error) {
		return (
			<PageShell>
				<ErrorState
					message="Automations are unavailable."
					details={`Start the Browser Control app service, then reload this page. Technical details: ${error}`}
				/>
			</PageShell>
		);
	}

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<div>
					<h2 className="text-lg font-semibold tracking-tight">Automations</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Review saved jobs Browser Control can run again later.
					</p>
				</div>
				<Card>
					<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
						<div>
							<CardTitle>Saved automations</CardTitle>
							<p className="mt-1 text-sm text-muted-foreground">
								Reusable tasks created from prompts or workflows.
							</p>
						</div>
						<Badge variant="secondary">{automations.length}</Badge>
					</CardHeader>
					<CardContent>
						{automations.length === 0 ? (
							<EmptyState
								title="No saved automations"
								description="Ask Browser Control to monitor a page or repeat a task, then save it here."
							/>
						) : (
							<DataTable
								data={automations}
								emptyMessage="No automations saved yet."
								columns={[
									{
										key: "name",
										header: "Automation",
										cell: (a) => (
											<div className="space-y-1">
												<div className="font-medium">{a.name}</div>
												<details className="text-xs text-muted-foreground">
													<summary className="cursor-pointer">
														Technical ID
													</summary>
													<code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-[11px]">
														{a.id}
													</code>
												</details>
											</div>
										),
									},
									{
										key: "prompt",
										header: "What it does",
										cell: (a) => (
											<div className="max-w-[520px] space-y-1 text-sm text-muted-foreground">
												<span className="block truncate">
													{summarizePrompt(a.prompt)}
												</span>
												{a.prompt.length > 90 && (
													<details className="text-xs">
														<summary className="cursor-pointer">
															Full instructions
														</summary>
														<p className="mt-1 whitespace-normal break-words">
															{a.prompt}
														</p>
													</details>
												)}
											</div>
										),
									},
									{
										key: "status",
										header: "Status",
										cell: () => <Badge variant="secondary">Saved</Badge>,
									},
								]}
							/>
						)}
					</CardContent>
				</Card>
			</div>
		</PageShell>
	);
}
