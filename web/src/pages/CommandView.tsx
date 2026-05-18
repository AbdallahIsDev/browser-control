import { ArrowRight, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "../api";

const SUGGESTIONS = [
	{
		label: "Research a website",
		prompt:
			"Research the website at [URL] and summarize key information including products, pricing, and contact details.",
	},
	{
		label: "Fill a form",
		prompt: "Fill out the form at [URL] with the following information: ",
	},
	{
		label: "Extract data",
		prompt: "Extract data from [URL] regarding [topic].",
	},
	{
		label: "Upload content",
		prompt:
			"Upload the file [file path] to [destination URL] and verify the upload was successful.",
	},
	{
		label: "Monitor a page",
		prompt: "Monitor the page at [URL] and notify me when [condition] changes.",
	},
	{ label: "Run workflow", prompt: "Run the workflow to " },
];

export function CommandView() {
	const [prompt, setPrompt] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleRun = async () => {
		if (!prompt) return;
		try {
			await apiFetch("/api/tasks", {
				method: "POST",
				body: JSON.stringify({ prompt, action: prompt.slice(0, 48) }),
			});
			setPrompt("");
		} catch (err: unknown) {
			console.error("Task failed", err);
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
		<PageShell className="flex items-center justify-center min-h-[70vh]">
			<div className="w-full max-w-[800px] flex flex-col items-center space-y-8 p-6">
				{/* Headline */}
				<div className="text-center space-y-3">
					<h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
						What should your agent do?
					</h2>
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

				{/* Prompt composer */}
				<div className="w-full relative border border-border/50 rounded shadow-sm bg-card">
					<Textarea
						ref={textareaRef}
						placeholder="Ask Browser Control to research a website, fill a form, upload content, monitor a page, or run a workflow..."
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
							aria-label="Attach file"
						>
							<Paperclip size={16} />
						</Button>

						<Button
							onClick={handleRun}
							disabled={!prompt}
							size="icon"
							className="h-8 w-8"
							aria-label="Run task"
						>
							<ArrowRight size={16} />
						</Button>
					</div>
				</div>
			</div>
		</PageShell>
	);
}
