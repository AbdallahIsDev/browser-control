(() => {
	const hashParams = new URLSearchParams(window.location.hash.slice(1));
	const hashToken = hashParams.get("token");
	if (hashToken) {
		sessionStorage.setItem("bc-token", hashToken);
		window.history.replaceState(
			null,
			"",
			window.location.pathname + window.location.search,
		);
	}
})();

const token = sessionStorage.getItem("bc-token") || "";

const state = {
	page: "overview",
	status: null,
	capabilities: null,
	events: [],
};

const { formatDateTime, formatCellValue, formatTerminalActionResult } =
	window.BrowserControlFormat;

const pages = [
	["overview", "Overview"],
	["browser", "Browser"],
	["tasks", "Tasks"],
	["automations", "Automations"],
	["terminal", "Terminal"],
	["filesystem", "Filesystem"],
	["logs", "Logs / Audit"],
	["debug", "Debug Evidence"],
	["settings", "Settings"],
	["health", "Health / Doctor"],
];

function esc(value) {
	return String(value ?? "").replace(
		/[&<>"']/g,
		(ch) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[ch],
	);
}

async function api(path, options = {}) {
	const response = await fetch(path, {
		...options,
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
			...(options.headers || {}),
		},
	});
	const text = await response.text();
	const body = text ? JSON.parse(text) : {};
	if (!response.ok) {
		const message = body.error || response.statusText;
		throw new Error(message);
	}
	return body;
}

function jsonBlock(value) {
	return `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
}

function setOutput(id, value) {
	const node = document.getElementById(id);
	if (node) {
		const renderValue =
			typeof value === "string"
				? value
				: JSON.stringify(
						value,
						(key, entry) =>
							typeof entry === "string" && formatCellValue(entry, key) !== entry
								? formatCellValue(entry, key)
								: entry,
						2,
					);
		node.textContent = renderValue;
	}
}

function actionSummary(value, fallback = "OK") {
	return formatTerminalActionResult(value, fallback);
}

function setRaw(id, value) {
	const node = document.getElementById(id);
	if (!node) return;
	node.textContent =
		typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setTerminalResult(value, fallback = "OK") {
	setOutput("term-output", actionSummary(value, fallback));
	setRaw("term-raw", value);
	const meta = document.getElementById("term-meta");
	if (meta && value?.data) {
		const data = value.data;
		meta.innerHTML = [
			data.id ? `<span>Session: ${esc(data.id)}</span>` : "",
			data.shell ? `<span>Shell: ${esc(data.shell)}</span>` : "",
			data.cwd ? `<span>CWD: ${esc(data.cwd)}</span>` : "",
			data.status ? `<span>Status: ${esc(data.status)}</span>` : "",
			data.exitCode !== undefined
				? `<span>Exit: ${esc(data.exitCode)}</span>`
				: "",
		]
			.filter(Boolean)
			.join("");
	}
}

function metric(label, value, detail = "") {
	return `<div class="panel"><h3>${esc(label)}</h3><div class="metric-value">${esc(value)}</div><div class="muted">${esc(detail)}</div></div>`;
}

function table(rows, columns) {
	if (!rows || rows.length === 0) return `<div class="empty">No entries.</div>`;
	return `<table><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows
		.map(
			(row) =>
				`<tr>${columns
					.map((c) => {
						const raw =
							typeof c.value === "function" ? c.value(row) : row[c.value];
						const key = typeof c.value === "string" ? c.value : c.label;
						return `<td>${esc(formatCellValue(raw, key))}</td>`;
					})
					.join("")}</tr>`,
		)
		.join("")}</tbody></table>`;
}

function renderShell() {
	document.getElementById("app").innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">BC</span><span>Browser Control</span></div>
        ${pages.map(([key, label]) => `<button class="nav-button ${state.page === key ? "active" : ""}" data-page="${key}">${label}</button>`).join("")}
      </aside>
      <main class="main">
        <div class="topbar">
          <div class="status-strip" id="status-strip"></div>
          <button id="refresh" title="Refresh">Refresh</button>
        </div>
        <div class="content">
          ${pages.map(([key]) => `<section id="page-${key}" class="page ${state.page === key ? "active" : ""}"></section>`).join("")}
        </div>
      </main>
    </div>`;

	document.querySelectorAll("[data-page]").forEach((button) => {
		button.addEventListener("click", () => {
			state.page = button.dataset.page;
			render();
		});
	});
	document.getElementById("refresh").addEventListener("click", refreshAll);
}

function renderStatus() {
	const status = state.status || {};
	const broker = status.broker?.reachable ? "ok" : "err";
	const daemon =
		status.daemon?.state === "running"
			? "ok"
			: status.daemon?.state === "degraded"
				? "warn"
				: "err";
	document.getElementById("status-strip").innerHTML = `
    <span class="badge ${daemon}">Daemon: ${esc(status.daemon?.state || "unknown")}</span>
    <span class="badge ${broker}">Broker: ${status.broker?.reachable ? "reachable" : "offline"}</span>
    <span class="badge">Policy: ${esc(status.policyProfile || "unknown")}</span>
    <span class="badge">Data: ${esc(status.dataHome || "")}</span>`;
}

function renderOverview() {
	const s = state.status || {};
	document.getElementById("page-overview").innerHTML = `
    <div class="grid metrics">
      ${metric("Daemon", s.daemon?.state || "unknown", s.daemon?.reason || "")}
      ${metric("Browser Sessions", s.browser?.activeSessions || 0, s.browser?.provider || "")}
      ${metric("Terminal Sessions", s.terminal?.activeSessions || 0)}
      ${metric("Queued / Running", `${s.tasks?.queued || 0} / ${s.tasks?.running || 0}`)}
    </div>
    <div class="grid two" style="margin-top:12px">
      <div class="panel"><h2>Recent Events</h2>${table(
				state.events.slice(-8).reverse(),
				[
					{ label: "Time", value: (row) => formatDateTime(row.timestamp) },
					{ label: "Type", value: "type" },
					{ label: "Session", value: "sessionId" },
				],
			)}</div>
      <div class="panel"><h2>Capabilities</h2>${jsonBlock(state.capabilities || {})}</div>
    </div>`;
}

function renderBrowser() {
	document.getElementById("page-browser").innerHTML = `
    <div class="panel">
      <h2>Browser Sessions</h2>
      <div class="form-grid">
        <input id="browser-url" placeholder="https://example.com">
        <button class="primary" id="browser-open">Open URL</button>
        <button id="browser-tabs">List Tabs</button>
      </div>
      <div class="row">
        <input id="browser-target" placeholder="@e1 or selector">
        <input id="browser-text" placeholder="Text/key">
        <button id="browser-snapshot">Snapshot</button>
        <button id="browser-click">Click</button>
        <button id="browser-fill">Fill</button>
        <button id="browser-press">Press</button>
        <button id="browser-shot">Screenshot</button>
      </div>
      <pre id="browser-output">No browser action yet.</pre>
    </div>`;
}

function renderTasks() {
	const cap = state.capabilities?.tasks;
	if (cap && cap.available === false) {
		document.getElementById("page-tasks").innerHTML =
			`<div class="panel"><h2>Tasks</h2><div class="empty error">${esc(cap.reason || "Unavailable")}</div></div>`;
		return;
	}
	document.getElementById("page-tasks").innerHTML = `
    <div class="panel">
      <h2>Tasks</h2>
      <div class="form-grid">
        <input id="task-skill" placeholder="skill (optional)">
        <input id="task-action" placeholder="action">
        <input id="task-params" placeholder='{"url":"https://example.com"}'>
      </div>
      <div class="row"><button class="primary" id="task-run">Run Task</button><button id="task-refresh">Refresh</button></div>
      <div id="task-table" style="margin-top:10px"></div>
    </div>`;
}

function renderAutomations() {
	const cap = state.capabilities?.automations;
	if (cap && cap.available === false) {
		document.getElementById("page-automations").innerHTML =
			`<div class="panel"><h2>Automations</h2><div class="empty error">${esc(cap.reason || "Unavailable")}</div></div>`;
		return;
	}
	document.getElementById("page-automations").innerHTML = `
    <div class="panel">
      <h2>Automations</h2>
      <div class="form-grid">
        <input id="auto-id" placeholder="automation id">
        <input id="auto-name" placeholder="name">
        <input id="auto-cron" placeholder="0 8 * * *">
      </div>
      <div class="row"><button class="primary" id="auto-create">Create</button><button id="auto-refresh">Refresh</button></div>
      <div id="auto-table" style="margin-top:10px"></div>
    </div>`;
}

function renderTerminal() {
	document.getElementById("page-terminal").innerHTML = `
    <div class="panel">
      <h2>Terminal</h2>
      <div class="form-grid">
        <input id="term-shell" placeholder="pwsh">
        <input id="term-cwd" placeholder="cwd">
        <button id="term-open">Open Session</button>
      </div>
      <div class="row">
        <select id="term-session-list" aria-label="Terminal sessions"><option value="">No sessions loaded</option></select>
        <input id="term-session" placeholder="session id">
        <input id="term-command" value="node --version">
        <button class="primary" id="term-exec">Exec</button>
        <button id="term-interrupt" class="danger">Interrupt</button>
        <button id="term-status">Status</button>
        <button id="term-read">Read</button>
        <button id="term-list">List</button>
        <button id="term-close" class="danger">Close</button>
      </div>
      <div class="row" style="margin-top: 10px">
        <label for="term-cols">Cols:</label>
        <input id="term-cols" type="number" value="80" style="min-width: 60px; width: 60px">
        <label for="term-rows">Rows:</label>
        <input id="term-rows" type="number" value="24" style="min-width: 60px; width: 60px">
        <button id="term-resize">Resize</button>
      </div>
      <div class="term-meta" id="term-meta"><span>No session selected.</span></div>
      <div class="terminal" id="term-output" style="margin-top: 12px">Idle</div>
      <details class="raw-details"><summary>Raw response</summary><pre id="term-raw">No raw response.</pre></details>
    </div>`;
}

function renderFilesystem() {
	document.getElementById("page-filesystem").innerHTML = `
    <div class="panel">
      <h2>Filesystem</h2>
      <div class="row">
        <input id="fs-path" value="." placeholder="path">
        <button id="fs-list">List</button>
        <button id="fs-read">Read</button>
        <button id="fs-stat">Stat</button>
      </div>
      <textarea id="fs-content" placeholder="content for write"></textarea>
      <div class="row"><button class="primary" id="fs-write">Write</button><button class="danger" id="fs-delete">Delete</button></div>
      <pre id="fs-output">Idle</pre>
    </div>`;
}

function renderLogs() {
	const cap = state.capabilities?.logs;
	if (cap && cap.available === false) {
		document.getElementById("page-logs").innerHTML =
			`<div class="panel"><h2>Logs / Audit</h2><div class="empty error">${esc(cap.reason || "Unavailable")}</div></div>`;
		return;
	}
	document.getElementById("page-logs").innerHTML = `
    <div class="panel">
      <h2>Logs / Audit</h2>
      <div class="row"><button id="logs-refresh">Refresh Logs</button><button id="events-refresh">Refresh Events</button></div>
      <div class="grid two" style="margin-top:10px">
        <pre id="logs-output">No logs loaded.</pre>
        <pre id="events-output">No events loaded.</pre>
      </div>
    </div>`;
}

function renderDebug() {
	const cap = state.capabilities?.debugEvidence;
	if (cap && cap.available === false) {
		document.getElementById("page-debug").innerHTML =
			`<div class="panel"><h2>Debug Evidence</h2><div class="empty error">${esc(cap.reason || "Unavailable")}</div></div>`;
		return;
	}
	document.getElementById("page-debug").innerHTML = `
    <div class="panel">
      <h2>Debug Evidence</h2>
      <div class="row"><button id="debug-bundles">Bundles</button><button id="debug-console">Console</button><button id="debug-network">Network</button><button id="debug-receipts">Receipts</button></div>
      <pre id="debug-output">No evidence loaded.</pre>
    </div>`;
}

function renderSettings() {
	document.getElementById("page-settings").innerHTML = `
    <div class="panel"><h2>Settings / Policy</h2><div id="config-table"></div><h3>Policy</h3><pre id="policy-output">Loading...</pre></div>`;
}

function renderHealth() {
	document.getElementById("page-health").innerHTML = `
    <div class="panel"><h2>Health / Doctor</h2><button class="primary" id="doctor-run">Run Doctor</button><pre id="doctor-output">Idle</pre></div>`;
}

function render() {
	renderShell();
	renderStatus();
	renderOverview();
	renderBrowser();
	renderTasks();
	renderAutomations();
	renderTerminal();
	renderFilesystem();
	renderLogs();
	renderDebug();
	renderSettings();
	renderHealth();
	bindActions();
}

function bindActions() {
	const bind = (id, fn) =>
		document.getElementById(id)?.addEventListener("click", fn);
	const sessionSelect = document.getElementById("term-session-list");
	sessionSelect?.addEventListener("change", () => {
		document.getElementById("term-session").value = sessionSelect.value;
	});

	bind("browser-open", async () =>
		setOutput(
			"browser-output",
			await api("/api/browser/open", {
				method: "POST",
				body: JSON.stringify({
					url: document.getElementById("browser-url").value,
				}),
			}).catch(String),
		),
	);
	bind("browser-tabs", async () =>
		setOutput("browser-output", await api("/api/browser/tabs").catch(String)),
	);
	bind("browser-snapshot", async () =>
		setOutput(
			"browser-output",
			await api("/api/browser/snapshot", { method: "POST", body: "{}" }).catch(
				String,
			),
		),
	);
	bind("browser-click", async () =>
		setOutput(
			"browser-output",
			await api("/api/browser/click", {
				method: "POST",
				body: JSON.stringify({
					target: document.getElementById("browser-target").value,
				}),
			}).catch(String),
		),
	);
	bind("browser-fill", async () =>
		setOutput(
			"browser-output",
			await api("/api/browser/fill", {
				method: "POST",
				body: JSON.stringify({
					target: document.getElementById("browser-target").value,
					text: document.getElementById("browser-text").value,
				}),
			}).catch(String),
		),
	);
	bind("browser-press", async () =>
		setOutput(
			"browser-output",
			await api("/api/browser/press", {
				method: "POST",
				body: JSON.stringify({
					key: document.getElementById("browser-text").value || "Enter",
				}),
			}).catch(String),
		),
	);
	bind("browser-shot", async () =>
		setOutput(
			"browser-output",
			await api("/api/browser/screenshot", {
				method: "POST",
				body: "{}",
			}).catch(String),
		),
	);

	bind("term-open", async () => {
		try {
			const data = await api("/api/terminal/sessions", {
				method: "POST",
				body: JSON.stringify({
					shell: document.getElementById("term-shell").value || undefined,
					cwd: document.getElementById("term-cwd").value || undefined,
				}),
			});
			const sessionId = data?.data?.id || data?.id;
			if (sessionId) document.getElementById("term-session").value = sessionId;
			setTerminalResult(
				data,
				sessionId ? `Opened session ${sessionId}` : "Session opened",
			);
			await loadTerminalSessions(sessionId);
		} catch (error) {
			setOutput("term-output", actionSummary(String(error)));
		}
	});
	bind("term-exec", async () => {
		api("/api/terminal/exec", {
			method: "POST",
			body: JSON.stringify({
				sessionId: document.getElementById("term-session").value || undefined,
				command: document.getElementById("term-command").value,
			}),
		})
			.then((data) => setTerminalResult(data, "Command finished"))
			.catch((error) => setOutput("term-output", actionSummary(String(error))));
	});
	bind("term-interrupt", async () =>
		setTerminalResult(
			await api(
				`/api/terminal/sessions/${encodeURIComponent(document.getElementById("term-session").value)}/interrupt`,
				{ method: "POST" },
			).catch(String),
		),
	);
	bind("term-status", async () =>
		setTerminalResult(
			await api(
				`/api/terminal/sessions/${encodeURIComponent(document.getElementById("term-session").value)}/status`,
			).catch(String),
			"Status loaded",
		),
	);
	bind("term-read", async () =>
		setTerminalResult(
			await api(
				`/api/terminal/sessions/${encodeURIComponent(document.getElementById("term-session").value)}/read`,
			).catch(String),
			"Read complete",
		),
	);
	bind("term-list", () => loadTerminalSessions());
	bind("term-close", async () => {
		const sessionId = document.getElementById("term-session").value;
		if (!sessionId) return setTerminalResult("No session selected.");
		if (!confirm(`Close terminal session ${sessionId}?`)) return;
		setTerminalResult(
			await api(`/api/terminal/sessions/${encodeURIComponent(sessionId)}`, {
				method: "DELETE",
			}).catch(String),
			"Session closed",
		);
		await loadTerminalSessions();
	});
	bind("term-resize", async () =>
		setTerminalResult(
			await api(
				`/api/terminal/sessions/${encodeURIComponent(document.getElementById("term-session").value)}/resize`,
				{
					method: "POST",
					body: JSON.stringify({
						cols: Number(document.getElementById("term-cols").value),
						rows: Number(document.getElementById("term-rows").value),
					}),
				},
			).catch(String),
			"Resize complete",
		),
	);

	bind("fs-list", async () =>
		setOutput(
			"fs-output",
			await api(
				`/api/fs/list?path=${encodeURIComponent(document.getElementById("fs-path").value)}`,
			).catch(String),
		),
	);
	bind("fs-read", async () =>
		setOutput(
			"fs-output",
			await api(
				`/api/fs/read?path=${encodeURIComponent(document.getElementById("fs-path").value)}`,
			).catch(String),
		),
	);
	bind("fs-stat", async () =>
		setOutput(
			"fs-output",
			await api(
				`/api/fs/stat?path=${encodeURIComponent(document.getElementById("fs-path").value)}`,
			).catch(String),
		),
	);
	bind("fs-write", async () =>
		setOutput(
			"fs-output",
			await api("/api/fs/write", {
				method: "POST",
				body: JSON.stringify({
					path: document.getElementById("fs-path").value,
					content: document.getElementById("fs-content").value,
				}),
			}).catch(String),
		),
	);
	bind("fs-delete", async () => {
		if (confirm(`Delete ${document.getElementById("fs-path").value}?`)) {
			setOutput(
				"fs-output",
				await api("/api/fs/delete", {
					method: "DELETE",
					body: JSON.stringify({
						path: document.getElementById("fs-path").value,
						force: true,
					}),
				}).catch(String),
			);
		}
	});

	bind("task-refresh", loadTasks);
	bind("task-run", runTask);
	bind("auto-refresh", loadAutomations);
	bind("auto-create", createAutomation);
	bind("logs-refresh", async () =>
		setOutput("logs-output", await api("/api/logs").catch(String)),
	);
	bind("events-refresh", async () =>
		setOutput("events-output", await api("/api/events/recent").catch(String)),
	);
	bind("debug-bundles", async () =>
		setOutput("debug-output", await api("/api/debug/bundles").catch(String)),
	);
	bind("debug-receipts", async () =>
		setOutput("debug-output", await api("/api/debug/receipts").catch(String)),
	);
	bind("debug-console", async () =>
		setOutput("debug-output", await api("/api/debug/console").catch(String)),
	);
	bind("debug-network", async () =>
		setOutput("debug-output", await api("/api/debug/network").catch(String)),
	);
	bind("doctor-run", async () =>
		setOutput(
			"doctor-output",
			await api("/api/doctor/run", { method: "POST", body: "{}" }).catch(
				String,
			),
		),
	);
}

async function loadTasks() {
	const target = document.getElementById("task-table");
	try {
		const rows = await api("/api/tasks");
		target.innerHTML = table(rows, [
			{ label: "ID", value: "id" },
			{ label: "Status", value: "status" },
			{ label: "Error", value: "error" },
		]);
	} catch (e) {
		target.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
	}
}

async function loadTerminalSessions(selectedId) {
	const select = document.getElementById("term-session-list");
	try {
		const result = await api("/api/terminal/sessions");
		setTerminalResult(result, "Sessions loaded");
		const data = result?.data ?? result;
		const sessions = Array.isArray(data)
			? data
			: Array.isArray(data?.sessions)
				? data.sessions
				: [];
		if (!select) return;
		if (sessions.length === 0) {
			select.innerHTML = `<option value="">No sessions</option>`;
			return;
		}
		select.innerHTML = sessions
			.map((session) => {
				const label = [
					session.id,
					session.shell,
					session.status,
					session.cwd,
					session.updatedAt ? formatDateTime(session.updatedAt) : "",
				]
					.filter(Boolean)
					.join(" | ");
				return `<option value="${esc(session.id)}">${esc(label)}</option>`;
			})
			.join("");
		const activeId =
			selectedId || document.getElementById("term-session").value;
		const chosen =
			sessions.find((session) => session.id === activeId) || sessions[0];
		select.value = chosen.id;
		document.getElementById("term-session").value = chosen.id;
		document.getElementById("term-meta").innerHTML = [
			`<span>Session: ${esc(chosen.id)}</span>`,
			chosen.shell ? `<span>Shell: ${esc(chosen.shell)}</span>` : "",
			chosen.cwd ? `<span>CWD: ${esc(chosen.cwd)}</span>` : "",
			chosen.status ? `<span>Status: ${esc(chosen.status)}</span>` : "",
			chosen.createdAt
				? `<span>Created: ${esc(formatDateTime(chosen.createdAt))}</span>`
				: "",
		]
			.filter(Boolean)
			.join("");
	} catch (error) {
		setTerminalResult(String(error));
	}
}

async function runTask() {
	const paramsRaw = document.getElementById("task-params").value.trim();
	const body = {
		skill: document.getElementById("task-skill").value || undefined,
		action: document.getElementById("task-action").value || undefined,
		params: paramsRaw ? JSON.parse(paramsRaw) : {},
	};
	await api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
	await loadTasks();
}

async function loadAutomations() {
	const target = document.getElementById("auto-table");
	try {
		const rows = await api("/api/automations");
		target.innerHTML = table(rows, [
			{ label: "ID", value: "id" },
			{ label: "Name", value: "name" },
			{ label: "Enabled", value: (row) => (row.enabled ? "yes" : "no") },
			{ label: "Next Run", value: "nextRun" },
		]);
	} catch (e) {
		target.innerHTML = `<div class="empty error">${esc(e.message)}</div>`;
	}
}

async function createAutomation() {
	await api("/api/automations", {
		method: "POST",
		body: JSON.stringify({
			id: document.getElementById("auto-id").value,
			name: document.getElementById("auto-name").value,
			cronExpression: document.getElementById("auto-cron").value,
		}),
	});
	await loadAutomations();
}

async function refreshAll() {
	try {
		const [status, capabilities, config, policy] = await Promise.all([
			api("/api/status"),
			api("/api/capabilities"),
			api("/api/config"),
			api("/api/policy/profile"),
		]);
		state.status = status;
		state.capabilities = capabilities;
		render();
		document.getElementById("config-table").innerHTML = table(config, [
			{ label: "Key", value: "key" },
			{ label: "Value", value: "value" },
			{ label: "Source", value: "source" },
			{ label: "Sensitive", value: (row) => (row.sensitive ? "yes" : "no") },
		]);
		setOutput("policy-output", policy);
	} catch (e) {
		document.getElementById("app").innerHTML =
			`<main class="content"><div class="panel"><h2>Disconnected</h2><p class="error">${esc(e.message)}</p><button id="reconnect">Retry</button></div></main>`;
		document
			.getElementById("reconnect")
			?.addEventListener("click", () => location.reload());
	}
}

function connectEvents() {
	const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events?token=${encodeURIComponent(token)}`;
	const socket = new WebSocket(url);
	socket.onmessage = (event) => {
		try {
			const payload = JSON.parse(event.data);
			if (payload.type === "terminal.output") {
				const termOutput = document.getElementById("term-output");
				if (termOutput) {
					// Clear "Idle" if present
					if (termOutput.textContent === "Idle") termOutput.textContent = "";

					// Only append if it's for the current session or no session is selected
					const currentSession = document.getElementById("term-session")?.value;
					const { sessionId, data } = payload.payload || {};
					if (!currentSession || sessionId === currentSession) {
						termOutput.textContent += data || "";
						termOutput.scrollTop = termOutput.scrollHeight;
					}
				}
				return;
			}

			if (Array.isArray(payload.events)) {
				state.events = payload.events;
			} else {
				state.events.push(payload);
				state.events = state.events.slice(-100);
			}
			if (state.page === "overview" || state.page === "logs") render();
		} catch {
			// Ignore malformed event frames.
		}
	};
	socket.onclose = () => {
		state.events.push({
			timestamp: new Date().toISOString(),
			type: "log.entry",
			payload: { message: "Event stream disconnected" },
		});
	};
}

renderShell();
refreshAll();
connectEvents();
