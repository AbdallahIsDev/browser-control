import { useEffect, useState } from "react";
import { DataTable } from "@/components/common/DataTable";
import { ErrorState } from "@/components/common/ErrorState";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "../api";
import type { Automation } from "../types";

export function AutomationsView() {
	const [automations, setAutomations] = useState<Automation[]>([]);
	const [error, setError] = useState("");

	useEffect(() => {
		apiFetch<Automation[]>("/api/saved-automations")
			.then(setAutomations)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error) {
		return (
			<PageShell>
				<ErrorState message="Error loading automations" details={error} />
			</PageShell>
		);
	}

	return (
		<PageShell>
			<Card>
				<CardContent>
					<DataTable
						data={automations}
						emptyMessage="No automations saved yet."
						columns={[
							{ key: "name", header: "Name", cell: (a) => a.name },
							{
								key: "prompt",
								header: "Prompt",
								cell: (a) => (
									<span className="max-w-[400px] truncate block">
										{a.prompt}
									</span>
								),
							},
						]}
					/>
				</CardContent>
			</Card>
		</PageShell>
	);
}
