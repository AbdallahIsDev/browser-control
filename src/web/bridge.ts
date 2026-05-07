import fs from "node:fs";
import path from "node:path";
import { redactObject, redactString } from "../observability/redaction";
import { loadConfig } from "../shared/config";
import { getLogsDir } from "../shared/paths";

export interface BrokerFetchOptions {
	env?: NodeJS.ProcessEnv;
	method?: "GET" | "POST" | "DELETE";
	body?: unknown;
}

export async function fetchBrokerJson(
	endpoint: string,
	options: BrokerFetchOptions = {},
): Promise<unknown> {
	const env = options.env ?? process.env;
	const config = loadConfig({ env, validate: false });
	const baseUrl = `http://127.0.0.1:${config.brokerPort}`;
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	const token = env.BROKER_API_KEY || env.BROKER_SECRET;
	if (token) headers.authorization = `Bearer ${token}`;

	const response = await fetch(`${baseUrl}${endpoint}`, {
		method: options.method ?? "GET",
		headers,
		...(options.body !== undefined
			? { body: JSON.stringify(options.body) }
			: {}),
	});
	const text = await response.text();
	const parsed = text ? (JSON.parse(text) as unknown) : {};
	if (!response.ok) {
		const error =
			parsed && typeof parsed === "object" && "error" in parsed
				? String((parsed as { error?: unknown }).error)
				: response.statusText;
		throw new Error(error);
	}
	return redactObject(parsed);
}

export interface LogEntry {
	file: string;
	line: string;
	timestamp?: string;
	level?: string;
	component?: string;
}

export function listLogFiles(): Array<{
	name: string;
	path: string;
	sizeBytes: number;
	modifiedAt: string;
}> {
	const dir = getLogsDir();
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter(
			(name) =>
				name.endsWith(".log") ||
				name.endsWith(".jsonl") ||
				name.endsWith(".txt"),
		)
		.map((name) => {
			const fullPath = path.join(dir, name);
			const stat = fs.statSync(fullPath);
			return {
				name,
				path: fullPath,
				sizeBytes: stat.size,
				modifiedAt: stat.mtime.toISOString(),
			};
		})
		.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function readRecentLogs(maxLines = 300): LogEntry[] {
	const files = listLogFiles().slice(0, 8);
	const entries: LogEntry[] = [];
	for (const file of files) {
		const raw = fs.readFileSync(file.path, "utf8");
		const lines = raw.split(/\r?\n/u).filter(Boolean).slice(-maxLines);
		for (const line of lines) {
			const redacted = redactString(line);
			let parsed: Record<string, unknown> | null = null;
			try {
				const maybe = JSON.parse(redacted) as unknown;
				if (maybe && typeof maybe === "object" && !Array.isArray(maybe))
					parsed = maybe as Record<string, unknown>;
			} catch {
				parsed = null;
			}
			entries.push({
				file: file.name,
				line: redacted,
				...(typeof parsed?.timestamp === "string"
					? { timestamp: parsed.timestamp }
					: {}),
				...(typeof parsed?.level === "string" ? { level: parsed.level } : {}),
				...(typeof parsed?.component === "string"
					? { component: parsed.component }
					: {}),
			});
		}
	}
	return entries.slice(-maxLines);
}
