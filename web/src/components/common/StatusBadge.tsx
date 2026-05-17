import { cn } from "@/lib/utils";

interface StatusBadgeProps {
	label: string;
	variant?: "ok" | "warn" | "info" | "neutral";
	className?: string;
}

const colorMap = {
	ok: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
	warn: "text-rose-400 bg-rose-500/10 border-rose-500/20",
	info: "text-sky-400 bg-sky-500/10 border-sky-500/20",
	neutral: "text-muted-foreground bg-muted/50 border-border",
};

export function StatusBadge({
	label,
	variant = "neutral",
	className,
}: StatusBadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center border px-2.5 py-0.5 text-xs font-semibold",
				colorMap[variant],
				className,
			)}
		>
			{label}
		</span>
	);
}
