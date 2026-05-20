import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, listBrowserDialogs, respondToBrowserDialog } from "../api";
import type { AppStatus, BrowserDialogInfo, BrowserDialogType } from "../types";

function dialogTypeLabel(t: BrowserDialogType): string {
	if (t === "alert") return "Alert";
	if (t === "confirm") return "Confirm";
	if (t === "prompt") return "Prompt";
	return "Before unload";
}

function formatDialogTime(createdAt: string): string {
	try {
		const d = new Date(createdAt);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleTimeString();
	} catch {
		return "";
	}
}

function PendingDialogCard({
	dialog,
	onRespond,
	responding,
}: {
	dialog: BrowserDialogInfo;
	onRespond: (id: string, action: "accept" | "dismiss", text?: string) => void;
	responding: boolean;
}) {
	const [promptText, setPromptText] = useState(dialog.defaultValue || "");

	return (
		<Card className="border-amber-500/40">
			<CardHeader className="pb-2">
				<CardTitle className="text-sm flex items-center gap-2">
					<span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
					Native browser dialog waiting
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				<div className="text-xs text-muted-foreground space-y-1">
					<div>
						<span className="font-medium">Type:</span>{" "}
						{dialogTypeLabel(dialog.type)}
					</div>
					{dialog.message ? (
						<div>
							<span className="font-medium">Message:</span> {dialog.message}
						</div>
					) : null}
					{dialog.createdAt ? (
						<div>
							<span className="font-medium">At:</span>{" "}
							{formatDialogTime(dialog.createdAt)}
						</div>
					) : null}
				</div>
				{dialog.type === "prompt" ? (
					<Input
						value={promptText}
						onChange={(e) => setPromptText(e.target.value)}
						placeholder="Enter response text..."
						disabled={responding}
					/>
				) : null}
				<div className="flex gap-2 pt-1">
					<Button
						size="sm"
						disabled={responding}
						onClick={() => onRespond(dialog.id, "accept", promptText)}
					>
						Accept
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={responding}
						onClick={() => onRespond(dialog.id, "dismiss")}
					>
						Dismiss
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

export function BrowserView() {
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [error, setError] = useState("");
	const [dialogs, setDialogs] = useState<BrowserDialogInfo[]>([]);
	const [dialogError, setDialogError] = useState("");
	const [dialogLoading, setDialogLoading] = useState(false);
	const [responding, setResponding] = useState<string | null>(null);

	const fetchDialogs = useCallback(() => {
		setDialogLoading(true);
		setDialogError("");
		listBrowserDialogs()
			.then((res) => {
				const list = res.data?.dialogs ?? [];
				setDialogs(list);
			})
			.catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				setDialogError(msg);
			})
			.finally(() => setDialogLoading(false));
	}, []);

	useEffect(() => {
		apiFetch<AppStatus>("/api/status")
			.then(setStatus)
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
		fetchDialogs();
	}, [fetchDialogs]);

	const handleRespond = useCallback(
		(id: string, action: "accept" | "dismiss", text?: string) => {
			setResponding(id);
			setDialogError("");
			respondToBrowserDialog(id, action, text)
				.then(() => fetchDialogs())
				.catch((err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					setDialogError(msg);
				})
				.finally(() => setResponding(null));
		},
		[fetchDialogs],
	);

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
				<div>
					<h2 className="text-lg font-semibold tracking-tight">Browser</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						See the browser sessions Browser Control is using for live work.
					</p>
				</div>
				{dialogLoading ? (
					<Card>
						<CardContent className="p-4 text-sm text-muted-foreground">
							Checking for pending dialogs...
						</CardContent>
					</Card>
				) : null}
				{dialogError ? (
					<Card>
						<CardContent className="p-4 text-sm text-destructive">
							Dialog check failed: {dialogError}
						</CardContent>
					</Card>
				) : null}
				{dialogs.length > 0 ? (
					<div className="space-y-3">
						{dialogs.map((d) => (
							<PendingDialogCard
								key={d.id}
								dialog={d}
								onRespond={handleRespond}
								responding={responding === d.id}
							/>
						))}
					</div>
				) : null}
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
								description="Start from Home with a website task, and Browser Control will open or attach a browser session here."
							/>
						</CardContent>
					</Card>
				)}
			</div>
		</PageShell>
	);
}
