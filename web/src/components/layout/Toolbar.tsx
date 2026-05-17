import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ToolbarProps {
	children: ReactNode;

	className?: string;
}

export function Toolbar({ children, className }: ToolbarProps) {
	return (
		<div
			className={cn(
				"h-14 md:h-16 px-4 md:px-8 flex items-center justify-between border-b border-border bg-background shrink-0",

				className,
			)}
		>
			{children}
		</div>
	);
}
