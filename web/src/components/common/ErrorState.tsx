import { cn } from "@/lib/utils";

interface ErrorStateProps {
	message: string;
	details?: string;
	className?: string;
}

export function ErrorState({ message, details, className }: ErrorStateProps) {
	return (
		<div
			className={cn(
				"rounded-md border border-rose-500/20 bg-rose-500/5 p-4",
				className,
			)}
		>
			<p className="text-sm font-medium text-rose-400">{message}</p>
			{details && (
				<p className="text-xs text-[--text-tertiary] mt-1">{details}</p>
			)}
		</div>
	);
}
