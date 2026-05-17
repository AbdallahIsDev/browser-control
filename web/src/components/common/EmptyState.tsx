import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
	title?: string;
	description?: string;
	action?: ReactNode;
	className?: string;
	icon?: ReactNode;
}

export function EmptyState({
	title = "Nothing here yet",
	description,
	action,
	className,
	icon,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center py-12 px-4 text-center",
				className,
			)}
		>
			{icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
			<p className="text-sm font-medium text-muted-foreground">{title}</p>
			{description && (
				<p className="mt-1 text-xs text-muted-foreground">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}
