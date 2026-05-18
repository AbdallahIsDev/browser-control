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
				"rounded-md border border-destructive/30 bg-destructive/10 p-4",
				className,
			)}
		>
			<p className="text-sm font-medium text-destructive">{message}</p>
			{details && (
				<p className="text-xs text-muted-foreground mt-1">{details}</p>
			)}
		</div>
	);
}
