import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
	label: string;
	value: ReactNode;
	icon?: ReactNode;
	className?: string;
}

export function MetricCard({ label, value, icon, className }: MetricCardProps) {
	return (
		<div className={cn("flex items-center gap-2 text-sm", className)}>
			{icon && <span className="text-[--text-tertiary]">{icon}</span>}
			<span className="text-[--text-tertiary]">{label}</span>
			<span>{value}</span>
		</div>
	);
}
