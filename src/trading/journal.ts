import fs from "node:fs";
import path from "node:path";
import { getTradingDir } from "../shared/paths";
import type { TradePlan } from "./trade_plan";

export function writeTradeJournalEntry(
	plan: TradePlan,
	content: string,
	dataHome?: string,
): string {
	const date = new Date(plan.createdAt);
	const day = Number.isNaN(date.getTime())
		? new Date().toISOString().slice(0, 10)
		: date.toISOString().slice(0, 10);
	const dir = path.join(getTradingDir(dataHome), "journals", day);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const fileName = `${plan.symbol}-${plan.id}.md`.replace(/[^a-z0-9._-]+/gi, "-");
	const filePath = path.join(dir, fileName);
	fs.writeFileSync(filePath, content, { mode: 0o600 });
	return filePath;
}
