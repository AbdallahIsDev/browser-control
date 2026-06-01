import { Check, Copy, KeyRound, Lock } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const commands = [
	{
		label: "Installed command",
		description: "Starts the local dashboard and opens a tokenized URL.",
		command: "bc web serve --open",
	},
	{
		label: "Port-busy fallback",
		description: "Use when port 7790 is already taken.",
		command: "bc web serve --open --port=0",
	},
	{
		label: "Source checkout",
		description: "Use inside this repo when running from source.",
		command: "npm run cli -- web serve --open",
	},
];

function CommandInlineCopy({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(command);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}, [command]);

	return (
		<div className="mt-4 flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-background/80 p-2">
			<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 font-mono text-xs font-semibold text-foreground">
				{command}
			</code>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				onClick={() => {
					void handleCopy();
				}}
				aria-label={`Copy command: ${command}`}
				title={`Copy command: ${command}`}
				className="shrink-0"
			>
				{copied ? <Check size={14} /> : <Copy size={14} />}
			</Button>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
			{copied && (
				<span className="shrink-0 text-xs font-medium text-primary">
					Copied
				</span>
			)}
		</div>
	);
}

function CommandCopyCard({
	label,
	description,
	command,
}: {
	label: string;
	description: string;
	command: string;
}) {
	return (
		<div className="min-w-0 rounded-2xl border border-border/60 bg-card/85 p-4">
			<p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
				{label}
			</p>
			<p className="mt-2 min-h-10 text-sm leading-5 text-muted-foreground">
				{description}
			</p>
			<CommandInlineCopy command={command} />
		</div>
	);
}

function AuthHelpPanel() {
	const [manualToken, setManualToken] = useState("");
	const [tokenError, setTokenError] = useState("");

	const handleManualToken = useCallback(() => {
		const trimmed = manualToken.trim();
		if (!trimmed) {
			setTokenError("Enter the local token first.");
			return;
		}
		sessionStorage.setItem("bc-token", trimmed);
		window.location.reload();
	}, [manualToken]);

	return (
		<div className="rounded-3xl border border-border/50 bg-background/70 p-5">
			<h3 className="text-sm font-semibold tracking-tight text-foreground">
				If the page stays locked
			</h3>
			<div className="mt-4 space-y-3 text-sm text-muted-foreground">
				<p>
					1. Run{" "}
					<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
						bc web serve --open
					</code>
				</p>
				<p>
					2. If port 7790 is busy, run{" "}
					<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
						bc web serve --open --port=0
					</code>
				</p>
				<p>
					3. From source, run{" "}
					<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
						npm run cli -- web serve --open
					</code>
				</p>
			</div>
			<div className="mt-5 rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
				Valid token URLs look like{" "}
				<code className="font-mono">
					{window.location.origin}/#token=&lt;one-time-token&gt;
				</code>
				.
			</div>
			<div className="mt-4 space-y-2">
				<label
					htmlFor="manual-dashboard-token"
					className="text-xs font-medium text-muted-foreground"
				>
					Manual local token
				</label>
				<div className="flex gap-2">
					<Input
						id="manual-dashboard-token"
						value={manualToken}
						onChange={(event) => {
							setManualToken(event.target.value);
							setTokenError("");
						}}
						type="password"
						placeholder="Paste local token"
					/>
					<Button type="button" onClick={handleManualToken}>
						<KeyRound size={14} />
						Sign in
					</Button>
				</div>
				{tokenError ? (
					<p className="text-xs text-destructive">{tokenError}</p>
				) : null}
			</div>
		</div>
	);
}

export function LockedDashboardScreen() {
	return (
		<div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-8 md:min-h-[calc(100vh-4rem)] md:px-8">
			<div className="w-full max-w-6xl">
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)] lg:items-start">
					<div className="space-y-5">
						<div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/40">
							<Lock size={28} className="text-muted-foreground/70" />
						</div>
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/70">
								Auth required
							</p>
							<h2 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
								Local dashboard locked
							</h2>
							<p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
								Open Browser Control from the CLI to generate a one-time local
								tokenized URL. Direct URLs stay locked by design.
							</p>
						</div>
					</div>
					<AuthHelpPanel />
				</div>

				<div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{commands.map((item) => (
						<CommandCopyCard key={item.command} {...item} />
					))}
				</div>
			</div>
		</div>
	);
}
