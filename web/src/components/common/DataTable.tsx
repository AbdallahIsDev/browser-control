import type { ReactNode } from "react";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";

interface Column<T> {
	key: string;
	header: ReactNode;
	cell: (item: T) => ReactNode;
}

interface DataTableProps<T> {
	data: T[];
	columns: Column<T>[];
	emptyMessage?: string;
	caption?: string;
	className?: string;
	rowKey?: (item: T, index: number) => string;
	onRowClick?: (item: T) => void;
}

function defaultRowKey<T>(item: T, index: number): string {
	if (typeof item === "object" && item !== null) {
		const candidate = item as { id?: unknown; key?: unknown; name?: unknown };
		if (candidate.id !== undefined) return String(candidate.id);
		if (candidate.key !== undefined) return String(candidate.key);
		if (candidate.name !== undefined) return String(candidate.name);
	}
	return `row-${index}`;
}

export function DataTable<T>({
	data,
	columns,
	emptyMessage = "No data available.",
	caption,
	className,
	rowKey,
	onRowClick,
}: DataTableProps<T>) {
	if (data.length === 0) {
		return <EmptyState title={emptyMessage} className="py-8" />;
	}

	return (
		<div className="overflow-x-auto">
			<Table className={cn("w-full", className)}>
				{caption && <TableCaption>{caption}</TableCaption>}
				<TableHeader>
					<TableRow>
						{columns.map((col) => (
							<TableHead key={col.key}>{col.header}</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{(Array.isArray(data) ? data : []).map((item, idx) => (
						<TableRow
							key={rowKey ? rowKey(item, idx) : defaultRowKey(item, idx)}
							onClick={onRowClick ? () => onRowClick(item) : undefined}
							className={onRowClick ? "cursor-pointer" : undefined}
						>
							{columns.map((col) => (
								<TableCell key={col.key}>{col.cell(item)}</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
