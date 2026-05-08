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
const { formatDateTime, formatCellValue } = window.BrowserControlFormat;

const state = {
	page: localStorage.getItem("bc-page") || "agent",
	theme: localStorage.getItem("bc-theme") || "dark",
	status: null,
	health: null,
	events: [],
	tasks: [],
	automations: [],
	config: [],
	notice: "",
	busy: false,
};

const pages = [
	["agent", "Agent"],
	["automations", "Automations"],
	["sessions", "Sessions"],
	["health", "Health"],
	["settings", "Settings"],
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
		throw new Error(body.error || response.statusText);
	}
	return body;
}

function setNotice(message) {
	state.notice = message || "";
	const node = document.getElementById("notice");
	if (node) node.textContent = state.notice;
}

function runtimeSummary() {
	const status = state.status || {};
	const daemonState = status.daemon?.state || "stopped";
	const brokerReady = status.broker?.reachable === true;
	const browserReady = Number(status.browser?.activeSessions || 0) > 0;
	const health = status.health?.overall || "unknown";
	return {
		agent: brokerReady && daemonState === "running" ? "Ready" : "Offline",
		agentTone: brokerReady && daemonState === "running" ? "ok" : "warn",
		browser: browserReady ? "Connected" : status.browser?.provider || "Local",
		health,
		dataHome: status.dataHome || "",
	};
}

function configValue(key) {
	const item = state.config.find((entry) => entry.key === key);
	return item?.value ?? "";
}

function renderShell() {
	document.documentElement.dataset.theme = state.theme;
	document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="rail">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">BC</div>
          <div>
            <div class="brand-name">Browser Control</div>
            <div class="brand-sub">Local agent workspace</div>
          </div>
        </div>
        <nav class="nav-list">
          ${pages
						.map(
							([key, label]) =>
								`<button class="nav-item ${state.page === key ? "active" : ""}" data-page="${key}">${label}</button>`,
						)
						.join("")}
        </nav>
        <div class="rail-footer">
          <button class="ghost-button" id="theme-toggle">${state.theme === "dark" ? "Light" : "Dark"} mode</button>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div>
            <div class="eyebrow">Local automation</div>
            <h1>${esc(pages.find(([key]) => key === state.page)?.[1] || "Agent")}</h1>
          </div>
          <div class="top-actions">
            ${statusPills()}
            <button id="refresh" class="icon-button" title="Refresh">Refresh</button>
          </div>
        </header>
        <div id="notice" class="notice">${esc(state.notice)}</div>
        <section id="view" class="view"></section>
      </main>
    </div>`;

	document.querySelectorAll("[data-page]").forEach((button) => {
		button.addEventListener("click", () => {
			state.page = button.dataset.page;
			localStorage.setItem("bc-page", state.page);
			render();
		});
	});
	document.getElementById("refresh").addEventListener("click", refreshAll);
	document.getElementById("theme-toggle").addEventListener("click", () => {
		state.theme = state.theme === "dark" ? "light" : "dark";
		localStorage.setItem("bc-theme", state.theme);
		render();
	});
}

function statusPills() {
	const summary = runtimeSummary();
	return `
    <span class="status-pill ${summary.agentTone}">Agent ${esc(summary.agent)}</span>
    <span class="status-pill">Browser ${esc(summary.browser)}</span>
    <span class="status-pill">Health ${esc(summary.health)}</span>`;
}

function metric(label, value, detail = "", tone = "") {
	return `
    <div class="metric ${tone}">
      <div class="metric-label">${esc(label)}</div>
      <div class="metric-value">${esc(value)}</div>
      <div class="metric-detail">${esc(detail)}</div>
    </div>`;
}

function renderAgent() {
	const summary = runtimeSummary();
	const recent = state.events.slice(-5).reverse();
	document.getElementById("view").innerHTML = `
    <div class="agent-layout">
      <section class="command-panel">
        <div class="command-head">
          <div>
            <div class="eyebrow">Ask the agent</div>
            <h2>What should Browser Control do?</h2>
          </div>
          <span class="model-chip">${esc(configValue("openrouterModel") || "Model not set")}</span>
        </div>
        <textarea id="agent-prompt" placeholder="Analyze a site, run a local workflow, or prepare a TradingView ICT plan..."></textarea>
        <div class="command-actions">
          <button class="primary" id="agent-run">Run task</button>
          <button id="agent-save">Save automation</button>
        </div>
      </section>
      <section class="overview-grid">
        ${metric("Agent runtime", summary.agent, summary.agent === "Ready" ? "Tasks can queue now" : "Start daemon to queue tasks", summary.agentTone)}
        ${metric("Saved automations", state.automations.length, "Reusable one-click workflows")}
        ${metric("Recent tasks", state.tasks.length, "Broker task history")}
        ${metric("Data", summary.dataHome ? "Local" : "Unknown", summary.dataHome)}
      </section>
      <section class="split">
        <div class="panel">
          <div class="panel-title">Pinned Automations</div>
          ${automationCards(state.automations.slice(0, 3))}
        </div>
        <div class="panel">
          <div class="panel-title">Recent Activity</div>
          ${recent.length ? recent.map(activityRow).join("") : emptyState("No recent activity yet.")}
        </div>
      </section>
    </div>`;
	document
		.getElementById("agent-run")
		.addEventListener("click", submitAgentTask);
	document
		.getElementById("agent-save")
		.addEventListener("click", savePromptAutomation);
}

function activityRow(event) {
	return `
    <div class="activity-row">
      <div>
        <strong>${esc(event.type || "event")}</strong>
        <span>${esc(formatDateTime(event.timestamp))}</span>
      </div>
      <span>${esc(event.sessionId || "system")}</span>
    </div>`;
}

function emptyState(message) {
	return `<div class="empty-state">${esc(message)}</div>`;
}

function automationCards(items) {
	if (!items.length) return emptyState("No automations saved yet.");
	return `<div class="automation-list">${items.map(automationCard).join("")}</div>`;
}

function automationCard(item) {
	const lastRun = item.lastRunAt ? formatDateTime(item.lastRunAt) : "Never run";
	return `
    <article class="automation-card">
      <div>
        <div class="automation-meta">${esc(item.category || "General")} ${item.approvalRequired ? "- approval required" : ""}</div>
        <h3>${esc(item.name)}</h3>
        <p>${esc(item.description || item.prompt)}</p>
      </div>
      <div class="automation-actions">
        <span>${esc(lastRun)}</span>
        <button class="primary" data-run-automation="${esc(item.id)}">Run</button>
      </div>
    </article>`;
}

function renderAutomations() {
	document.getElementById("view").innerHTML = `
    <div class="page-stack">
      <section class="panel">
        <div class="panel-title">Automation Library</div>
        ${automationCards(state.automations)}
      </section>
      <section class="panel compact-form">
        <div class="panel-title">Create Automation</div>
        <input id="automation-name" placeholder="Automation name">
        <textarea id="automation-prompt" placeholder="What should this automation do?"></textarea>
        <button class="primary" id="automation-create">Save automation</button>
      </section>
    </div>`;
	document
		.getElementById("automation-create")
		.addEventListener("click", createAutomation);
}

function renderSessions() {
	document.getElementById("view").innerHTML = `
    <div class="split">
      <section class="panel">
        <div class="panel-title">Task History</div>
        ${
					state.tasks.length
						? table(state.tasks, [
								["Task", (row) => row.id || row.taskId || row.name],
								["Status", (row) => row.status],
								[
									"Updated",
									(row) => row.updatedAt || row.completedAt || row.startedAt,
								],
							])
						: emptyState("No broker tasks reported.")
				}
      </section>
      <section class="panel">
        <div class="panel-title">Event Stream</div>
        ${state.events.length ? state.events.slice(-12).reverse().map(activityRow).join("") : emptyState("No event stream yet.")}
      </section>
    </div>`;
}

function renderHealth() {
	const health = state.health || {};
	document.getElementById("view").innerHTML = `
    <div class="overview-grid">
      ${metric("Overall", health.overall || runtimeSummary().health, "Doctor summary")}
      ${metric("Pass", health.pass ?? state.status?.health?.pass ?? 0)}
      ${metric("Warn", health.warn ?? state.status?.health?.warn ?? 0, "", "warn")}
      ${metric("Fail", health.fail ?? state.status?.health?.fail ?? 0, "", "danger")}
    </div>
    <section class="panel spaced">
      <div class="panel-title">Health Doctor</div>
      <button class="primary" id="doctor-run">Run health check</button>
      <div id="doctor-output" class="doctor-output">${health.checks ? health.checks.map((check) => `<div>${esc(check.name || check.id)} - ${esc(check.status || "")}</div>`).join("") : "No doctor run yet."}</div>
    </section>`;
	document.getElementById("doctor-run").addEventListener("click", runDoctor);
}

function renderSettings() {
	document.getElementById("view").innerHTML = `
    <section class="panel settings-panel">
      <div class="panel-title">Model Connection</div>
      <label>Base URL<input id="openrouterBaseUrl" value="${esc(configValue("openrouterBaseUrl"))}" placeholder="https://openrouter.ai/api/v1"></label>
      <label>Model<input id="openrouterModel" value="${esc(configValue("openrouterModel"))}" placeholder="provider/model"></label>
      <label>API key<input id="openrouterApiKey" value="" type="password" placeholder="Stored locally"></label>
      <button class="primary" id="settings-save">Save model settings</button>
    </section>`;
	document
		.getElementById("settings-save")
		.addEventListener("click", saveSettings);
}

function table(rows, columns) {
	return `<div class="table">${rows
		.map(
			(row) =>
				`<div class="table-row">${columns
					.map(([label, get]) => {
						const raw = typeof get === "function" ? get(row) : row[get];
						return `<div><span>${esc(label)}</span><strong>${esc(formatCellValue(raw, label))}</strong></div>`;
					})
					.join("")}</div>`,
		)
		.join("")}</div>`;
}

async function submitAgentTask() {
	const prompt = document.getElementById("agent-prompt").value.trim();
	if (!prompt) return setNotice("Enter a task first.");
	state.busy = true;
	setNotice("Submitting task...");
	try {
		await api("/api/tasks", {
			method: "POST",
			body: JSON.stringify({
				action: prompt.slice(0, 48),
				prompt,
				params: { prompt },
			}),
		});
		setNotice("Task queued.");
		document.getElementById("agent-prompt").value = "";
		await refreshAll();
	} catch (error) {
		await saveAutomationFromPrompt(prompt, "Saved from agent input");
		setNotice(`Runtime offline. Saved as automation. ${error.message}`);
	}
	state.busy = false;
}

async function savePromptAutomation() {
	const prompt = document.getElementById("agent-prompt").value.trim();
	if (!prompt) return setNotice("Enter automation instructions first.");
	await saveAutomationFromPrompt(prompt, "Saved from agent input");
	document.getElementById("agent-prompt").value = "";
	setNotice("Automation saved.");
	await refreshAll();
}

async function saveAutomationFromPrompt(prompt, description) {
	return api("/api/saved-automations", {
		method: "POST",
		body: JSON.stringify({
			name: prompt.slice(0, 48),
			description,
			prompt,
		}),
	});
}

async function createAutomation() {
	const name = document.getElementById("automation-name").value.trim();
	const prompt = document.getElementById("automation-prompt").value.trim();
	if (!name || !prompt) return setNotice("Name and instructions are required.");
	await api("/api/saved-automations", {
		method: "POST",
		body: JSON.stringify({ name, prompt }),
	});
	setNotice("Automation saved.");
	await refreshAll();
}

async function runAutomation(id) {
	setNotice("Running automation...");
	const result = await api(
		`/api/saved-automations/${encodeURIComponent(id)}/run`,
		{
			method: "POST",
		},
	);
	setNotice(result.queued ? "Automation queued." : result.message);
	await refreshAll();
}

async function runDoctor() {
	setNotice("Running health doctor...");
	state.health = await api("/api/doctor/run", { method: "POST" });
	setNotice("Health check complete.");
	render();
}

async function saveSettings() {
	const keys = ["openrouterBaseUrl", "openrouterModel", "openrouterApiKey"];
	for (const key of keys) {
		const value = document.getElementById(key).value.trim();
		if (value) {
			await api(`/api/config/${encodeURIComponent(key)}`, {
				method: "POST",
				body: JSON.stringify({ value }),
			});
		}
	}
	setNotice("Model settings saved.");
	await refreshAll();
}

function render() {
	renderShell();
	if (state.page === "agent") renderAgent();
	else if (state.page === "automations") renderAutomations();
	else if (state.page === "sessions") renderSessions();
	else if (state.page === "health") renderHealth();
	else renderSettings();
	document.querySelectorAll("[data-run-automation]").forEach((button) => {
		button.addEventListener("click", () =>
			runAutomation(button.dataset.runAutomation),
		);
	});
}

async function refreshAll() {
	try {
		const [status, events, automations, config] = await Promise.all([
			api("/api/status"),
			api("/api/events/recent").catch(() => []),
			api("/api/saved-automations").catch(() => []),
			api("/api/config").catch(() => []),
		]);
		state.status = status;
		state.events = Array.isArray(events) ? events : [];
		state.automations = Array.isArray(automations) ? automations : [];
		state.config = Array.isArray(config) ? config : [];
		state.tasks = await api("/api/tasks").catch(() => []);
		render();
	} catch (error) {
		document.getElementById("app").innerHTML = `
      <div class="locked-screen">
        <div class="brand-mark large">BC</div>
        <h1>Browser Control is locked</h1>
        <p>${esc(error.message || "Open this app from Browser Control Desktop or CLI.")}</p>
      </div>`;
	}
}

refreshAll();
