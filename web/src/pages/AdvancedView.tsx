import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "../api";

export function AdvancedView() {
	const [cleanupConfirm, setCleanupConfirm] = useState("");
	const [cleanupStatus, setCleanupStatus] = useState("");
	const [doctorStatus, setDoctorStatus] = useState("");
	const [doctorDetails, setDoctorDetails] = useState("");
	const [doctorLoading, setDoctorLoading] = useState(false);
	const [isCleaning, setIsCleaning] = useState(false);
	const [showConfirmDialog, setShowConfirmDialog] = useState(false);

	const runDoctor = async () => {
		setDoctorLoading(true);
		setDoctorStatus("");
		setDoctorDetails("");
		try {
			const res = await apiFetch("/api/doctor/run", { method: "POST" });
			setDoctorStatus("Diagnostics finished.");
			setDoctorDetails(JSON.stringify(res, null, 2));
		} catch (err: unknown) {
			setDoctorStatus("Diagnostics failed.");
			setDoctorDetails(err instanceof Error ? err.message : String(err));
		} finally {
			setDoctorLoading(false);
		}
	};

	const performCleanup = async (dryRun: boolean) => {
		if (!dryRun && cleanupConfirm !== "DELETE_RUNTIME_TEMP") {
			setCleanupStatus("Error: Must type confirmation exactly.");
			return;
		}

		setIsCleaning(true);
		setCleanupStatus(dryRun ? "Starting dry run..." : "Starting deletion...");
		try {
			const result = await apiFetch("/api/data/cleanup", {
				method: "POST",
				body: JSON.stringify({
					dryRun,
					confirm: dryRun ? "" : cleanupConfirm,
				}),
			});
			setCleanupStatus(JSON.stringify(result, null, 2));
		} catch (err: unknown) {
			setCleanupStatus(
				`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setIsCleaning(false);
		}
	};

	return (
		<PageShell>
			<div className="space-y-4 md:space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>System Diagnostics</CardTitle>
						<CardDescription>
							Run the system doctor to check for common issues and
							misconfigurations.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<Button onClick={runDoctor} disabled={doctorLoading}>
							{doctorLoading ? "Running..." : "Run Doctor Diagnostics"}
						</Button>
						{doctorStatus ? (
							<div className="rounded border border-border/60 bg-muted/20 p-3 text-sm">
								<p>{doctorStatus}</p>
								{doctorDetails ? (
									<details className="mt-2 text-xs text-muted-foreground">
										<summary className="cursor-pointer">
											Technical details
										</summary>
										<pre className="mt-2 max-h-72 overflow-auto rounded bg-background p-2">
											{doctorDetails}
										</pre>
									</details>
								) : null}
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Durable State & Storage Maintenance</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<h4 className="text-sm font-medium mb-2">Runtime Cleanup</h4>
							<p className="text-sm text-muted-foreground mb-4">
								Deletes temporary profiles, downloads, and automation scratch
								files. This is a destructive operation.
							</p>

							<div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
								<Button
									variant="outline"
									disabled={isCleaning}
									onClick={() => performCleanup(true)}
									className="sm:w-auto w-full"
								>
									Dry Run Cleanup
								</Button>

								<div className="flex flex-col sm:flex-row gap-2 flex-1 min-w-0">
									<Input
										placeholder='Type "DELETE_RUNTIME_TEMP" to confirm'
										value={cleanupConfirm}
										onChange={(e) => setCleanupConfirm(e.target.value)}
										className="flex-1 w-full"
									/>
									<Button
										variant="destructive"
										disabled={
											isCleaning || cleanupConfirm !== "DELETE_RUNTIME_TEMP"
										}
										onClick={() => setShowConfirmDialog(true)}
										className="sm:w-auto w-full"
									>
										Confirm Deletion
									</Button>
								</div>
							</div>

							{cleanupStatus && (
								<pre className="mt-4 p-3 bg-black rounded-md text-sm overflow-x-auto">
									{cleanupStatus}
								</pre>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			<ConfirmDialog
				open={showConfirmDialog}
				onOpenChange={setShowConfirmDialog}
				title="Confirm Runtime Cleanup"
				description="This will permanently delete temporary profiles, downloads, and automation scratch files. Are you sure?"
				confirmLabel="Delete"
				cancelLabel="Cancel"
				variant="destructive"
				onConfirm={() => performCleanup(false)}
			/>
		</PageShell>
	);
}
