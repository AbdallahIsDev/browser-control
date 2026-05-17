import { cn } from "@/lib/utils";

interface LoadingStateProps {
	message?: string;
	className?: string;
}

export function LoadingState({
	message = "Loading...",
	className,
}: LoadingStateProps) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 py-8 text-sm text-[--text-tertiary]",
				className,
			)}
		>
			<div className="h-4 w-4 animate-spin rounded-full border-2 border-[--text-tertiary] border-t-transparent" />
			<span>{message}</span>
		</div>
	);
}
