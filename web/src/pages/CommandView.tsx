import {
	ArrowRight,
	FilePlus2,
	History,
	RotateCcw,
	ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "../api";

const SUGGESTIONS = [
	{
		label: "Run Automation Package",
		action: "run-package",
	},
	{
		label: "Create Package from Successful Run",
		action: "create-draft",
	},
	{
		label: "Repair Failed Package",
		action: "repair-package",
	},
	{
		label: "Open Evidence Report",
		action: "open-evidence",
	},
	{
		label: "Review Permissions",
		action: "review-permissions",
	},
] as const;

type PackageAction = (typeof SUGGESTIONS)[number]["action"];

export function CommandView() {
	const [action, setAction] = useState<PackageAction>("run-package");
	const [packageName, setPackageName] = useState("");
	const [workflow, setWorkflow] = useState("main");
	const [recordingId, setRecordingId] = useState("");
	const [runId, setRunId] = useState("");
	const [reviewStatus, setReviewStatus] = useState("pending");
	const [notes, setNotes] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState("");
	const [submitMessage, setSubmitMessage] = useState("");

	const handleRun = async () => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setSubmitError("");
		setSubmitMessage("");
		try {
			if (action === "run-package") {
				if (!packageName.trim() || !workflow.trim()) {
					throw new Error("Package name and workflow are required.");
				}
				await apiFetch(`/api/packages/${encodeURIComponent(packageName)}/run`, {
					method: "POST",
					body: JSON.stringify({ workflow }),
				});
				setSubmitMessage("Package run started.");
			} else if (action === "create-draft") {
				if (!recordingId.trim()) {
					throw new Error("Recording id is required.");
				}
				await apiFetch(
					`/api/recordings/${encodeURIComponent(recordingId)}/materialize`,
					{
						method: "POST",
						body: JSON.stringify({ install: true, overwrite: true }),
					},
				);
				setSubmitMessage("Package draft saved and installed.");
			} else if (action === "review-permissions") {
				if (!packageName.trim()) {
					throw new Error("Package name is required.");
				}
				await apiFetch(`/api/packages/${encodeURIComponent(packageName)}/review`, {
					method: "POST",
					body: JSON.stringify({
						status: reviewStatus,
						reviewedBy: "web-user",
						reason: notes,
					}),
				});
				setSubmitMessage("Package review recorded.");
			} else if (action === "open-evidence") {
				if (!runId.trim()) throw new Error("Run id is required.");
				window.location.hash = `#evidence:${encodeURIComponent(runId)}`;
				setSubmitMessage("Evidence view selected.");
			} else {
				if (!runId.trim()) throw new Error("Run id is required.");
				setSubmitMessage("Repair workspace recorded. Use evidence view to patch and re-evaluate package.");
			}
		} catch (err: unknown) {
			setSubmitError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			e.preventDefault();
			handleRun();
		}
	};

	const handleSuggestion = (nextAction: PackageAction) => {
		setAction(nextAction);
	};

	const canSubmit = Boolean(
		(action === "run-package" && packageName.trim() && workflow.trim()) ||
		(action === "create-draft" && recordingId.trim()) ||
		(action === "review-permissions" && packageName.trim()) ||
			((action === "open-evidence" || action === "repair-package") &&
				runId.trim()),
	);

	return (
		<PageShell className="min-h-[70vh]">
			<div className="mx-auto w-full max-w-[980px] space-y-6 p-4 md:p-6">
				<div className="space-y-2">
					<h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
						Run or create an Automation Package
					</h2>
					<p className="text-sm text-muted-foreground">
						Package replay, draft creation, evidence, repair, permissions, and
						savings metrics are the primary workflow.
					</p>
				</div>

				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div className="rounded-md border border-border/70 bg-card p-4">
						<FilePlus2 size={18} className="text-primary" />
						<p className="mt-3 text-sm font-medium">Create package draft</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Capture steps, selectors, screenshots, waits, and outputs.
						</p>
					</div>
					<div className="rounded-md border border-border/70 bg-card p-4">
						<History size={18} className="text-primary" />
						<p className="mt-3 text-sm font-medium">Run history</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Review replay results, failures, and saved reports.
						</p>
					</div>
					<div className="rounded-md border border-border/70 bg-card p-4">
						<RotateCcw size={18} className="text-primary" />
						<p className="mt-3 text-sm font-medium">Repair failures</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Mark broken selectors and retry with evidence.
						</p>
					</div>
					<div className="rounded-md border border-border/70 bg-card p-4">
						<ShieldCheck size={18} className="text-primary" />
						<p className="mt-3 text-sm font-medium">Permissions review</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Check domains, filesystem access, and high-risk actions.
						</p>
					</div>
				</div>

				{/* Suggestion chips */}
				<div className="flex flex-wrap gap-2 justify-center pt-2">
					{SUGGESTIONS.map((s) => (
						<Button
							key={s.label}
							type="button"
							variant={action === s.action ? "default" : "outline"}
							size="sm"
							onClick={() => handleSuggestion(s.action)}
							className="h-9 px-4 rounded text-xs font-medium text-muted-foreground bg-background hover:bg-muted/50 border-border/75!"
						>
							{s.label}
						</Button>
					))}
				</div>

				{/* Package action composer */}
				<div className="w-full relative border border-border/50 rounded shadow-sm bg-card">
					<div className="grid gap-4 p-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label>Action</Label>
							<Select
								value={action}
								onValueChange={(value) => setAction(value as PackageAction)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SUGGESTIONS.map((item) => (
										<SelectItem key={item.action} value={item.action}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{action === "run-package" || action === "review-permissions" ? (
							<div className="space-y-2">
								<Label>Package</Label>
								<Input
									value={packageName}
									onChange={(e) => setPackageName(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="package-name"
								/>
							</div>
						) : null}
						{action === "run-package" ? (
							<div className="space-y-2">
								<Label>Workflow</Label>
								<Input
									value={workflow}
									onChange={(e) => setWorkflow(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="workflow id or name"
								/>
							</div>
						) : null}
						{action === "create-draft" ? (
							<div className="space-y-2">
								<Label>Recording id</Label>
								<Input
									value={recordingId}
									onChange={(e) => setRecordingId(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="rec-..."
								/>
							</div>
						) : null}
						{action === "repair-package" || action === "open-evidence" ? (
							<div className="space-y-2">
								<Label>Run id</Label>
								<Input
									value={runId}
									onChange={(e) => setRunId(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="run id"
								/>
							</div>
						) : null}
						{action === "review-permissions" ? (
							<div className="space-y-2">
								<Label>Review status</Label>
								<Select
									value={reviewStatus}
									onValueChange={(value) => {
										if (value) setReviewStatus(value);
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="pending">Pending</SelectItem>
										<SelectItem value="approved">Approved</SelectItem>
										<SelectItem value="rejected">Rejected</SelectItem>
									</SelectContent>
								</Select>
							</div>
						) : null}
						<div className="space-y-2 md:col-span-2">
							<Label>Notes</Label>
							<Textarea
								placeholder="Inputs, evidence notes, repair notes, or permission review reason"
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								onKeyDown={handleKeyDown}
								className="min-h-[92px] resize-none bg-transparent!"
							/>
						</div>
					</div>

					{/* Action row */}
					<div className="flex items-center justify-between p-2 gap-2">
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
							aria-label="Attach evidence file"
							title="Evidence attachments are not available in this dashboard yet"
							disabled
						>
							<FilePlus2 size={16} />
						</Button>

						<Button
							onClick={handleRun}
							disabled={!canSubmit || isSubmitting}
							size="icon"
							className="h-8 w-8"
							aria-label="Run package action"
						>
							<ArrowRight size={16} />
						</Button>
					</div>
				</div>
				{submitError ? (
					<p className="w-full text-sm text-destructive">{submitError}</p>
				) : null}
				{submitMessage ? (
					<p className="w-full text-sm text-muted-foreground">
						{submitMessage}
					</p>
				) : null}
			</div>
		</PageShell>
	);
}
