import {
	ArrowRight,
	FilePlus2,
	History,
	RotateCcw,
	ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "../api";

const SUGGESTIONS = [
	{
		label: "Run Automation Package",
		prompt:
			"Run the Automation Package named [package-name] with these inputs: ",
	},
	{
		label: "Create Package from Successful Run",
		prompt:
			"Capture the successful browser workflow at [URL] as an Automation Package draft.",
	},
	{
		label: "Repair Failed Package",
		prompt:
			"Repair the failed Automation Package run [run-id] using latest evidence.",
	},
	{
		label: "Open Evidence Report",
		prompt:
			"Open the evidence and report output for Automation Package run [run-id].",
	},
	{
		label: "Review Permissions",
		prompt:
			"Review permissions and risk for Automation Package [package-name].",
	},
];

export function CommandView() {
	const [prompt, setPrompt] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState("");
	const [submitMessage, setSubmitMessage] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleRun = async () => {
		if (!prompt.trim() || isSubmitting) return;
		setIsSubmitting(true);
		setSubmitError("");
		setSubmitMessage("");
		try {
			await apiFetch("/api/tasks", {
				method: "POST",
				body: JSON.stringify({ prompt, action: prompt.slice(0, 48) }),
			});
			setPrompt("");
			setSubmitMessage("Task submitted.");
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

	const handleSuggestion = (suggestionPrompt: string) => {
		setPrompt(suggestionPrompt);
		textareaRef.current?.focus();
	};

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
							variant="outline"
							size="sm"
							onClick={() => handleSuggestion(s.prompt)}
							className="h-9 px-4 rounded text-xs font-medium text-muted-foreground bg-background hover:bg-muted/50 border-border/75!"
						>
							{s.label}
						</Button>
					))}
				</div>

				{/* Package command composer */}
				<div className="w-full relative border border-border/50 rounded shadow-sm bg-card">
					<Textarea
						ref={textareaRef}
						placeholder="Run a package, create a package draft from a successful browser workflow, repair a failed package, or open evidence..."
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={handleKeyDown}
						className="min-h-[140px] md:min-h-[160px] text-[15px] leading-relaxed resize-none bg-transparent! border-0 p-4 focus-visible:ring-0 placeholder:text-muted-foreground/60"
					/>

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
							disabled={!prompt.trim() || isSubmitting}
							size="icon"
							className="h-8 w-8"
							aria-label="Run task"
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
