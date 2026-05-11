export function formatDateTime(value: unknown): string {
	if (!value) return "Unknown time";
	const date = new Date(value as string);
	if (Number.isNaN(date.getTime())) return "Unknown time";
	return date.toLocaleString();
}

export function formatCellValue(value: unknown, key?: string): string {
	if (key === "timestamp" || key === "updatedAt" || key === "createdAt") {
		return formatDateTime(value);
	}
	return String(value ?? "");
}

export function formatTerminalActionResult(
	result: any,
	fallback = "Idle",
): string {
	if (!result) return fallback;
	if (!result.success) return result.error || "Failed";
	const data = result.data || {};
	let out = "";
	if (data.stdout) out += `stdout: ${data.stdout}\n`;
	if (data.stderr) out += `stderr: ${data.stderr}\n`;
	if (typeof data.exitCode === "number") out += `exit code: ${data.exitCode}`;
	return out || fallback;
}
