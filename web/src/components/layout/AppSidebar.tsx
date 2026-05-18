import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import BcLogo from "@/assets/branding/bc-logo.svg?react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
	locked?: boolean;
	collapsed?: boolean;
	onToggleCollapsed?: () => void;
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
	locked,
	collapsed = false,
	onToggleCollapsed,
}: AppSidebarProps) {
	return (
		<aside
			className={cn(
				"app-sidebar shrink-0 flex flex-col bg-card z-100 transition-[width,transform] duration-300",
				collapsed ? "w-[76px]" : "w-[260px]",
				className,
			)}
			data-collapsed={collapsed ? "true" : "false"}
		>
			<div
				className={cn(
					"flex",
					collapsed
						? "flex-col items-center gap-2 p-2"
						: "items-center gap-3 p-3",
				)}
			>
				<div className="w-8 h-8 flex items-center justify-center">
					{brand.icon}
				</div>
				{!collapsed && (
					<span className="font-semibold text-sm tracking-tight truncate">
						{brand.text}
					</span>
				)}
				{onToggleCollapsed && (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={cn("hidden md:inline-flex", !collapsed && "ml-auto")}
						onClick={onToggleCollapsed}
						aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
					>
						{collapsed ? (
							<PanelLeftOpen size={16} />
						) : (
							<PanelLeftClose size={16} />
						)}
					</Button>
				)}
			</div>

			{!locked && (
				<nav className="flex-1 p-2 overflow-y-auto">
					{items.map((item) => (
						<Tooltip key={item.id}>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant={active === item.id ? "default" : "ghost"}
										size={collapsed ? "icon" : "sm"}
										className={cn(
											"mb-0.5 w-full gap-3",
											collapsed ? "justify-center" : "justify-start",
											active !== item.id &&
												"text-muted-foreground hover:bg-muted/50 hover:text-foreground",
										)}
										onClick={() => onSelect(item.id)}
										aria-label={item.label}
										title={item.label}
									>
										<span className="w-4 h-4 shrink-0">{item.icon}</span>
										{!collapsed && (
											<span className="nav-label truncate font-medium">
												{item.label}
											</span>
										)}
									</Button>
								}
							/>
							<TooltipContent side="right" hidden={!collapsed}>
								{item.label}
							</TooltipContent>
						</Tooltip>
					))}
				</nav>
			)}

			{footer && !collapsed && <div className="p-3">{footer}</div>}
		</aside>
	);
}
