(function attachBrowserControlFormat(root) {
	function isDateLikeString(value) {
		return (
			typeof value === "string" &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
		);
	}

	function formatDateTime(value) {
		if (!value) return "Unknown time";
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) return "Unknown time";
		return new Intl.DateTimeFormat(undefined, {
			year: "numeric",
			month: "short",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			timeZoneName: "short",
		}).format(date);
	}

	function isDateKey(key) {
		const name = String(key || "");
		return (
			/^(timestamp|date|time)$/u.test(name) ||
			/(?:At|Date|Time|Run)$/u.test(name)
		);
	}

	function formatCellValue(value, key) {
		if (value === null || value === undefined || value === "") return "";
		if (value instanceof Date || isDateLikeString(value) || isDateKey(key)) {
			return formatDateTime(value);
		}
		if (typeof value === "object") return JSON.stringify(value);
		return String(value);
	}

	function formatTerminalActionResult(value, fallback) {
		if (typeof value === "string") return value;
		if (!value || typeof value !== "object") return fallback || "OK";
		if (value.success === false)
			return `Error: ${value.error || "Action failed"}`;
		const data = value.data || value;
		const lines = [];
		if (data.id) lines.push(`session: ${data.id}`);
		if (data.shell) lines.push(`shell: ${data.shell}`);
		if (data.cwd) lines.push(`cwd: ${data.cwd}`);
		if (data.status) lines.push(`status: ${data.status}`);
		if (typeof data.stdout === "string" && data.stdout.length > 0) {
			lines.push(`stdout:\n${data.stdout.trimEnd()}`);
		}
		if (typeof data.stderr === "string" && data.stderr.length > 0) {
			lines.push(`stderr:\n${data.stderr.trimEnd()}`);
		}
		if (data.output) lines.push(`output:\n${String(data.output).trimEnd()}`);
		if (data.exitCode !== undefined) lines.push(`exit code: ${data.exitCode}`);
		if (data.durationMs !== undefined)
			lines.push(`duration: ${data.durationMs} ms`);
		return lines.length > 0 ? lines.join("\n") : fallback || "OK";
	}

	const api = { formatDateTime, formatCellValue, formatTerminalActionResult };
	root.BrowserControlFormat = api;
	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
})(typeof globalThis !== "undefined" ? globalThis : window);
