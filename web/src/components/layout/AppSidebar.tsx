import type { ReactNode } from "react";
import BcLogo from "@/assets/branding/bc-logo.svg?react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NavItem = {
	id: string;
	label: string;
	icon: ReactNode;
};

interface AppSidebarProps {
	brand?: { icon: ReactNode; text: string };
	items: NavItem[];
	active?: string;
	onSelect: (id: string) => void;
	footer?: ReactNode;
	className?: string;
}

export function AppSidebar({
	brand = {
		icon: (
			<BcLogo className="w-8 h-8 dark:invert transition-all duration-300" />
		),
		text: "Browser Control",
	},
	items,
	active,
	onSelect,
	footer,
	className,
}: AppSidebarProps) {
	return (
		<aside
			className={cn(
				"app-sidebar w-[260px] shrink-0 flex flex-col bg-card border-r border-border z-100 transition-transform duration-300",
				className,
			)}
		>
			<div className="p-4 flex items-center gap-3 border-b border-border">
				<div className="w-8 h-8 flex items-center justify-center">
					{brand.icon}
				</div>
				<span className="font-semibold text-sm tracking-tight truncate">
					{brand.text}
				</span>
			</div>

			<nav className="flex-1 p-2 overflow-y-auto">
				{items.map((item) => (
					<Button
						key={item.id}
						type="button"
						variant={active === item.id ? "default" : "ghost"}
						size="sm"
						className={cn(
							"mb-0.5 w-full justify-start gap-3",
							active !== item.id &&
								"text-muted-foreground hover:bg-muted/50 hover:text-foreground",
						)}
						onClick={() => onSelect(item.id)}
					>
						<span className="w-4 h-4 shrink-0">{item.icon}</span>
						<span className="nav-label truncate font-medium">{item.label}</span>
					</Button>
				))}
			</nav>

			{footer && <div className="p-3 border-t border-border">{footer}</div>}
		</aside>
	);
}
