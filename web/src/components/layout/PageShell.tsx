import type * as React from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
	children: React.ReactNode;
	className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
	return (
		<div
			className={cn(
				"mx-auto w-full max-w-screen-2xl flex-1 min-w-0 px-4 py-5 sm:px-6 lg:px-8 animate-fade-in",
				className,
			)}
		>
			{children}
		</div>
	);
}
