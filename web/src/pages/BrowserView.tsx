import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "../api";
import type { AppStatus } from "../types";

export function BrowserView() {
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		apiFetch<AppStatus>("/api/status")
			.then(setStatus)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
	}, []);

	if (error) {
		return (
			<PageShell>
				<ErrorState message="Error loading browser status" details={error} />
			</PageShell>
		);
	}

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				{status?.browser?.activeSessions &&
				status.browser.activeSessions > 0 ? (
					<>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<Card>
								<CardHeader>
									<CardTitle>Provider</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-2xl font-semibold">
										{status.browser.provider || "Unknown"}
									</p>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>Active Sessions</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-2xl font-semibold">
										{status.browser.activeSessions}
									</p>
								</CardContent>
							</Card>
						</div>
						<div className="flex flex-col sm:flex-row gap-3">
							<Button className="sm:w-auto w-full">Open URL</Button>
							<Button variant="outline" className="sm:w-auto w-full">
								Take Screenshot
							</Button>
						</div>
					</>
				) : (
					<Card>
						<CardContent className="p-6">
							<EmptyState
								title="No active browser sessions"
								description="Open a URL to start a session."
							/>
						</CardContent>
					</Card>
				)}
			</div>
		</PageShell>
	);
}
