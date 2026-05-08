import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
	type BrowserControlAPI,
	createBrowserControl,
} from "../browser_control";
import { redactObject, redactString } from "../observability/redaction";
import { getAllProfiles } from "../policy/profiles";
import { formatActionResult } from "../shared/action_result";
import { logger } from "../shared/logger";
import { getDataHome } from "../shared/paths";
import { validateResize } from "../terminal/actions";
import { fetchBrokerJson, listLogFiles, readRecentLogs } from "./bridge";
import { WebEventHub } from "./events";
import {
	assertSafeBind,
	createLocalToken,
	isAuthorizedRequest,
	readJsonBody,
	setCorsHeaders,
	setSecurityHeaders,
} from "./security";
import type { WebAppServerInfo, WebCapabilities } from "./types";

const webLogger = logger.withComponent("web");

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export interface WebAppServerOptions {
	host?: string;
	port?: number;
	token?: string;
	allowRemote?: boolean;
	api?: BrowserControlAPI;
	allowedOrigins?: string[];
}

export interface WebAppServer {
	listen(port?: number, host?: string): Promise<WebAppServerInfo>;
	close(): Promise<void>;
	address(): AddressInfo | string | null;
	info(): WebAppServerInfo | null;
	events: WebEventHub;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7790;

interface SavedAutomation {
	id: string;
	name: string;
	description: string;
	category: string;
	prompt: string;
	source: "built-in" | "user" | "task";
	status: "ready" | "last-run";
	approvalRequired: boolean;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	runCount: number;
}

function automationStorePath(): string {
	return path.join(getDataHome(), "automations", "saved-automations.json");
}

function slugifyAutomationId(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 64);
	return slug || `automation-${Date.now()}`;
}

function builtInAutomations(now = new Date().toISOString()): SavedAutomation[] {
	return [
		{
			id: "tradingview-ict-analysis",
			name: "TradingView ICT Analysis",
			description:
				"Analyze the active TradingView chart with ICT confluence and prepare a trade plan for review.",
			category: "Trading",
			prompt:
				"Use the TradingView MCP chart state, OHLCV, visible indicators, and drawings to analyze market structure with the packaged guide at automation-packages/tradingview-ict-analysis/docs/ict-methodology.md. Prioritize fair value gaps, order blocks, liquidity sweeps, displacement, market structure shift, premium/discount, and OTE. Produce bias, invalidation, entry zone, stop, targets, risk notes, and a journal-ready summary. Do not place live trades unless the user explicitly approves the exact order.",
			source: "built-in",
			status: "ready",
			approvalRequired: true,
			createdAt: now,
			updatedAt: now,
			runCount: 0,
		},
	];
}

function readSavedAutomations(): SavedAutomation[] {
	const filePath = automationStorePath();
	if (!fs.existsSync(filePath)) {
		const defaults = builtInAutomations();
		writeSavedAutomations(defaults);
		return defaults;
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		if (!Array.isArray(parsed)) return builtInAutomations();
		return parsed as SavedAutomation[];
	} catch {
		return builtInAutomations();
	}
}

function writeSavedAutomations(automations: SavedAutomation[]): void {
	const filePath = automationStorePath();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(automations, null, 2), "utf8");
}

function upsertSavedAutomation(
	input: Partial<SavedAutomation> & { name: string; prompt: string },
): SavedAutomation {
	const now = new Date().toISOString();
	const automations = readSavedAutomations();
	const id = input.id || slugifyAutomationId(input.name);
	const existingIndex = automations.findIndex((item) => item.id === id);
	const existing = existingIndex >= 0 ? automations[existingIndex] : undefined;
	const next: SavedAutomation = {
		id,
		name: input.name,
		description: input.description || existing?.description || "",
		category: input.category || existing?.category || "General",
		prompt: input.prompt,
		source: input.source || existing?.source || "user",
		status: input.status || existing?.status || "ready",
		approvalRequired:
			input.approvalRequired ?? existing?.approvalRequired ?? true,
		createdAt: existing?.createdAt || input.createdAt || now,
		updatedAt: now,
		lastRunAt: input.lastRunAt || existing?.lastRunAt,
		runCount: input.runCount ?? existing?.runCount ?? 0,
	};
	if (existingIndex >= 0) automations[existingIndex] = next;
	else automations.unshift(next);
	writeSavedAutomations(automations);
	return next;
}

function rememberRequestAutomation(
	body: Record<string, unknown>,
	source: "task" | "user",
): void {
	const action = asOptionalString(body.action) || asOptionalString(body.name);
	const prompt =
		asOptionalString(body.prompt) ||
		asOptionalString(
			(body.params as Record<string, unknown> | undefined)?.prompt,
		) ||
		(action
			? `Run ${action} with parameters ${JSON.stringify(body.params ?? {})}`
			: "");
	if (!action || !prompt) return;
	upsertSavedAutomation({
		id: slugifyAutomationId(action),
		name: action,
		description: "Saved automatically from a submitted task.",
		category: "Recent",
		prompt,
		source,
	});
}

function json(
	response: ServerResponse,
	statusCode: number,
	payload: unknown,
): void {
	if (!response.headersSent)
		response.setHeader("Content-Type", "application/json");
	response.writeHead(statusCode);
	response.end(JSON.stringify(redactObject(payload)));
}

function html(
	response: ServerResponse,
	statusCode: number,
	body: string,
): void {
	response.setHeader("Content-Type", "text/html; charset=utf-8");
	response.writeHead(statusCode);
	response.end(body);
}

function text(
	response: ServerResponse,
	statusCode: number,
	body: string,
	contentType = "text/plain; charset=utf-8",
): void {
	response.setHeader("Content-Type", contentType);
	response.writeHead(statusCode);
	response.end(body);
}

function asString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${name} is required.`);
	return value;
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

async function capabilities(api: BrowserControlAPI): Promise<WebCapabilities> {
	const status = await api.status();
	const brokerReachable = status.broker?.reachable === true;
	const desktopAvailable =
		fs.existsSync(path.join(__dirname, "..", "..", "desktop", "main.cjs")) ||
		fs.existsSync(path.resolve(process.cwd(), "desktop", "main.cjs"));

	let observabilityOk = false;
	try {
		const debugHealth = await api.debug.health();
		observabilityOk =
			debugHealth.overall === "healthy" || debugHealth.overall === "degraded";
	} catch {
		observabilityOk = false;
	}

	return {
		status: { key: "status", available: true },
		config: { key: "config", available: true },
		policy: { key: "policy", available: true },
		browser: { key: "browser", available: true },
		terminal: { key: "terminal", available: true },
		filesystem: { key: "filesystem", available: true },
		tasks: {
			key: "tasks",
			available: brokerReachable,
			reason: brokerReachable ? undefined : "Broker is not reachable.",
		},
		automations: {
			key: "automations",
			available: brokerReachable,
			reason: brokerReachable
				? undefined
				: "Scheduler requires broker to be reachable.",
		},
		logs: {
			key: "logs",
			available: observabilityOk,
			reason: observabilityOk
				? undefined
				: "Logging and observability store is unavailable.",
		},
		debugEvidence: {
			key: "debugEvidence",
			available: observabilityOk,
			reason: observabilityOk
				? undefined
				: "Debug evidence store is unavailable.",
		},
		desktop: {
			key: "desktop",
			available: desktopAvailable,
			reason: desktopAvailable ? undefined : "Desktop shell files not found.",
		},
	};
}

function getStaticRoot(): string {
	const candidates = [
		path.resolve(process.cwd(), "web", "dist"),
		path.resolve(__dirname, "..", "..", "web", "dist"),
	];
	return (
		candidates.find((candidate) =>
			fs.existsSync(path.join(candidate, "index.html")),
		) ?? ""
	);
}

function contentTypeFor(filePath: string): string {
	switch (path.extname(filePath).toLowerCase()) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		default:
			return "application/octet-stream";
	}
}

function serveStatic(
	response: ServerResponse,
	staticRoot: string,
	pathname: string,
): boolean {
	if (!staticRoot) return false;
	const requested =
		pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
	const resolved = path.resolve(staticRoot, requested);
	const relative = path.relative(staticRoot, resolved);
	if (
		relative.startsWith("..") ||
		path.isAbsolute(relative) ||
		!fs.existsSync(resolved) ||
		!fs.statSync(resolved).isFile()
	) {
		return false;
	}
	const content = fs.readFileSync(resolved);
	text(response, 200, content.toString("utf8"), contentTypeFor(resolved));
	return true;
}

function indexHtml(nonce: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser Control Operator</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f7f8fa; color: #17191c; }
    .locked-screen { display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 16px; }
    .locked-screen h1 { font-size: 20px; }
    main { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    nav { background: #15191f; color: white; padding: 18px 14px; }
    nav h1 { font-size: 16px; margin: 0 0 18px; font-weight: 650; }
    nav a { display: block; color: #d8dde6; padding: 8px 10px; text-decoration: none; border-radius: 6px; }
    nav a:hover { background: #252b35; }
    section { padding: 20px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; }
    .panel { background: white; border: 1px solid #dde2ea; border-radius: 8px; padding: 14px; }
    .panel h2 { margin: 0 0 8px; font-size: 14px; }
    pre { white-space: pre-wrap; overflow: auto; max-height: 360px; background: #101418; color: #d8f3dc; padding: 12px; border-radius: 6px; }
    button, input { font: inherit; }
    button { border: 1px solid #b9c1ce; background: white; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
    input { border: 1px solid #b9c1ce; padding: 7px 9px; border-radius: 6px; min-width: 260px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    @media (max-width: 800px) { main { grid-template-columns: 1fr; } nav { position: static; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div id="locked" class="locked-screen">
    <h1>Browser Control Locked</h1>
    <p>Please open via CLI or provide a valid token.</p>
  </div>
  <main id="app" style="display:none">
    <nav>
      <h1>Browser Control</h1>
      <a href="#overview">Overview</a>
      <a href="#terminal">Terminal</a>
      <a href="#browser">Browser</a>
      <a href="#filesystem">Filesystem</a>
      <a href="#settings">Settings</a>
    </nav>
    <section>
      <div class="grid" id="summary"></div>
      <div class="panel" id="terminal-panel" style="margin-top:12px">
        <h2>Terminal</h2>
        <div class="row">
          <input id="command" value="node --version" aria-label="Command">
          <button id="run">Run</button>
        </div>
        <pre id="terminalOut">Idle</pre>
      </div>
      <div class="panel" id="events" style="margin-top:12px">
        <h2>Events</h2>
        <pre id="eventOut">Connecting...</pre>
      </div>
    </section>
  </main>
  <script nonce="${nonce}">
    (function() {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      let token = hashParams.get("token");
      if (token) {
        sessionStorage.setItem("bc-token", token);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } else {
        token = sessionStorage.getItem("bc-token");
      }

      if (!token) return;

      document.getElementById("locked").style.display = "none";
      document.getElementById("app").style.display = "grid";

      async function api(path, options = {}) {
        const res = await fetch(path, {
          ...options,
          headers: {
            "content-type": "application/json",
            "authorization": "Bearer " + token,
            ...(options.headers || {})
          }
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || res.statusText);
        return body;
      }
      async function refresh() {
        const status = await api("/api/status");
        const caps = await api("/api/capabilities");
        document.getElementById("summary").innerHTML = [
          ["Daemon", status.daemon?.state || "unknown"],
          ["Broker", status.broker?.reachable ? "reachable" : "offline"],
          ["Policy", status.policyProfile || "unknown"],
          ["Terminal", String(status.terminal?.activeSessions || 0)]
        ].map(([k,v]) => '<div class="panel"><h2>'+k+'</h2><strong>'+v+'</strong></div>').join("");
        window.__capabilities = caps;
      }
      document.getElementById("run").addEventListener("click", async () => {
        const command = document.getElementById("command").value;
        document.getElementById("terminalOut").textContent = "Running...";
        try {
          const result = await api("/api/terminal/exec", { method: "POST", body: JSON.stringify({ command }) });
          document.getElementById("terminalOut").textContent = JSON.stringify(result, null, 2);
        } catch (e) {
          document.getElementById("terminalOut").textContent = e.message;
        }
      });
      const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/events?token=" + encodeURIComponent(token));
      ws.onmessage = (event) => { document.getElementById("eventOut").textContent = event.data; };
      ws.onerror = () => { document.getElementById("eventOut").textContent = "Event stream disconnected"; };
      refresh().catch((e) => { document.getElementById("summary").textContent = e.message; });
    })();
  </script>
</body>
</html>`;
}

export function createWebAppServer(
	options: WebAppServerOptions = {},
): WebAppServer {
	const token = options.token ?? createLocalToken();
	const host = options.host ?? DEFAULT_HOST;
	const port = options.port ?? DEFAULT_PORT;
	assertSafeBind(host, options.allowRemote === true);

	const api = options.api ?? createBrowserControl();
	const events = new WebEventHub();

	// Wire up real-time terminal output streaming to the dashboard event hub.
	// NOTE: Terminal output is broadcast to ALL authenticated dashboard
	// WebSocket clients via WebEventHub, not per-session subscribers. Events
	// are redacted through redactObject() before broadcast. Raw output is
	// never logged.
	const termSub = api.terminal.onOutput((sessionId, data) => {
		events.emit("terminal.output", { sessionId, data });
	});

	const server = http.createServer();
	let currentInfo: WebAppServerInfo | null = null;
	let allowedOrigins = options.allowedOrigins ?? [`http://${host}:${port}`];
	const staticRoot = getStaticRoot();

	async function handleApi(
		request: IncomingMessage,
		response: ServerResponse,
		requestUrl: URL,
	): Promise<void> {
		const { pathname } = requestUrl;

		if (request.method === "GET" && pathname === "/api/status") {
			const status = await api.status();
			events.emit("runtime.status", status);
			json(response, 200, status);
			return;
		}

		if (request.method === "GET" && pathname === "/api/capabilities") {
			json(response, 200, await capabilities(api));
			return;
		}

		if (request.method === "GET" && pathname === "/api/health") {
			const health = await api.debug.health();
			json(response, 200, health);
			return;
		}

		if (request.method === "GET" && pathname === "/api/events/recent") {
			json(response, 200, events.listRecent());
			return;
		}

		// ── Sessions ─────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/sessions") {
			const result = api.session.list();
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/sessions") {
			const body = await readJsonBody(request);
			const name = asString(body.name, "name");
			const result = await api.session.create(name, {
				policyProfile: asOptionalString(body.policyProfile),
				workingDirectory: asOptionalString(body.workingDirectory),
			});
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/sessions/use") {
			const body = await readJsonBody(request);
			const nameOrId = asString(body.nameOrId, "nameOrId");
			const result = api.session.use(nameOrId);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		const sessionStatusMatch = /^\/api\/sessions\/([^/]+)\/status$/u.exec(
			pathname,
		);
		if (request.method === "GET" && sessionStatusMatch) {
			const id = decodeURIComponent(sessionStatusMatch[1] ?? "");
			const result = api.session.status(id);
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Config ───────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/config") {
			json(response, 200, api.config.list());
			return;
		}

		const configKeyMatch = /^\/api\/config\/([^/]+)$/u.exec(pathname);
		if (request.method === "GET" && configKeyMatch) {
			const key = decodeURIComponent(configKeyMatch[1] ?? "");
			json(response, 200, api.config.get(key));
			return;
		}

		if (request.method === "POST" && configKeyMatch) {
			const key = decodeURIComponent(configKeyMatch[1] ?? "");
			const body = await readJsonBody(request);
			const result = api.config.set(key, body.value);
			events.emit("log.entry", {
				component: "web",
				message: `Config set: ${key}`,
			});
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		// ── Policy ───────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/policy/profile") {
			json(response, 200, {
				active: api.config.get("policyProfile"),
				profiles: getAllProfiles(),
			});
			return;
		}

		if (request.method === "GET" && pathname === "/api/policy/profiles") {
			const { listBuiltInProfiles, listCustomProfiles } = await import(
				"../policy/profiles"
			);
			json(response, 200, {
				builtIn: listBuiltInProfiles().map((p) => ({ name: p.name })),
				custom: listCustomProfiles().map((p) => ({ name: p.name })),
			});
			return;
		}

		// ── Debug Evidence ───────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/debug/bundles") {
			json(response, 200, api.debug.listBundles());
			return;
		}

		if (
			request.method === "GET" &&
			pathname.startsWith("/api/debug/bundles/")
		) {
			const bundleId = decodeURIComponent(
				pathname.slice("/api/debug/bundles/".length),
			);
			const bundle = api.debug.bundle(bundleId);
			if (!bundle) {
				json(response, 404, {
					success: false,
					code: "not_found",
					error: `Debug bundle not found: ${bundleId}`,
				});
				return;
			}
			json(response, 200, bundle);
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/console") {
			json(
				response,
				200,
				api.debug.console({
					sessionId: requestUrl.searchParams.get("sessionId") || undefined,
				}),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/network") {
			json(
				response,
				200,
				api.debug.network({
					sessionId: requestUrl.searchParams.get("sessionId") || undefined,
				}),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/debug/receipts") {
			const { getObservabilityDir } = await import("../shared/paths");
			const receiptsDir = path.join(getObservabilityDir(), "receipts");
			const receipts: unknown[] = [];
			if (fs.existsSync(receiptsDir)) {
				for (const sessionId of fs.readdirSync(receiptsDir)) {
					const sessionPath = path.join(receiptsDir, sessionId);
					if (fs.statSync(sessionPath).isDirectory()) {
						for (const file of fs.readdirSync(sessionPath)) {
							if (file.startsWith("receipt-") && file.endsWith(".json")) {
								try {
									receipts.push(
										JSON.parse(
											fs.readFileSync(path.join(sessionPath, file), "utf8"),
										),
									);
								} catch {}
							}
						}
					}
				}
			}
			receipts.sort((a, b) =>
				((b as { completedAt?: string }).completedAt || "").localeCompare(
					(a as { completedAt?: string }).completedAt || "",
				),
			);
			json(response, 200, receipts);
			return;
		}

		const receiptMatch = /^\/api\/debug\/receipts\/([^/]+)$/u.exec(pathname);
		if (request.method === "GET" && receiptMatch) {
			const receiptId = decodeURIComponent(receiptMatch[1] ?? "");
			const receipt = api.debug.receipt(receiptId);
			if (!receipt) {
				json(response, 404, {
					success: false,
					code: "not_found",
					error: `Receipt not found: ${receiptId}`,
				});
				return;
			}
			json(response, 200, receipt);
			return;
		}

		if (request.method === "GET" && pathname === "/api/screenshots") {
			const { getRuntimeDir } = await import("../shared/paths");
			const runtimeDir = getRuntimeDir();
			const files: unknown[] = [];
			if (fs.existsSync(runtimeDir)) {
				for (const dateDir of fs.readdirSync(runtimeDir)) {
					const datePath = path.join(runtimeDir, dateDir);
					if (!fs.statSync(datePath).isDirectory()) continue;
					for (const sessionDir of fs.readdirSync(datePath)) {
						const sessionPath = path.join(datePath, sessionDir);
						if (!fs.statSync(sessionPath).isDirectory()) continue;
						const screenshotsDir = path.join(sessionPath, "screenshots");
						if (fs.existsSync(screenshotsDir)) {
							for (const name of fs.readdirSync(screenshotsDir)) {
								if (
									name.endsWith(".png") ||
									name.endsWith(".jpg") ||
									name.endsWith(".jpeg")
								) {
									const fullPath = path.join(screenshotsDir, name);
									const stat = fs.statSync(fullPath);
									files.push({
										name,
										path: fullPath,
										sizeBytes: stat.size,
										modifiedAt: stat.mtime.toISOString(),
										sessionDir,
									});
								}
							}
						}
					}
				}
			}
			files.sort((a, b) =>
				(b as { modifiedAt: string }).modifiedAt.localeCompare(
					(a as { modifiedAt: string }).modifiedAt,
				),
			);
			json(response, 200, files.slice(0, 50));
			return;
		}

		// ── Logs ─────────────────────────────────────────────────────────
		if (request.method === "GET" && pathname === "/api/logs/files") {
			json(response, 200, listLogFiles());
			return;
		}

		if (request.method === "GET" && pathname === "/api/logs") {
			json(
				response,
				200,
				readRecentLogs(Number(requestUrl.searchParams.get("maxLines")) || 300),
			);
			return;
		}

		if (request.method === "GET" && pathname === "/api/audit") {
			const { getDefaultAuditLogger } = await import("../policy/audit");
			const logger = getDefaultAuditLogger();
			const entries = logger?.getAll(100) ?? [];
			json(response, 200, entries);
			return;
		}

		if (request.method === "POST" && pathname === "/api/doctor/run") {
			const { runDoctor } = await import("../operator/doctor");
			json(response, 200, await runDoctor());
			return;
		}

		if (request.method === "GET" && pathname === "/api/saved-automations") {
			json(response, 200, readSavedAutomations());
			return;
		}

		if (request.method === "POST" && pathname === "/api/saved-automations") {
			const body = await readJsonBody(request);
			const automation = upsertSavedAutomation({
				name: asString(body.name, "name"),
				description: asOptionalString(body.description) || "",
				category: asOptionalString(body.category) || "General",
				prompt: asString(body.prompt, "prompt"),
				source: "user",
				approvalRequired: body.approvalRequired !== false,
			});
			json(response, 200, automation);
			return;
		}

		const savedAutomationRunMatch =
			/^\/api\/saved-automations\/([^/]+)\/run$/u.exec(pathname);
		if (request.method === "POST" && savedAutomationRunMatch) {
			const id = decodeURIComponent(savedAutomationRunMatch[1] ?? "");
			const automations = readSavedAutomations();
			const automation = automations.find((item) => item.id === id);
			if (!automation) {
				json(response, 404, {
					success: false,
					code: "not_found",
					error: `Automation not found: ${id}`,
				});
				return;
			}

			const now = new Date().toISOString();
			const updated = upsertSavedAutomation({
				...automation,
				status: "last-run",
				lastRunAt: now,
				runCount: automation.runCount + 1,
			});

			try {
				const result = await fetchBrokerJson("/api/v1/tasks/run", {
					method: "POST",
					body: {
						action: updated.name,
						params: {
							automationId: updated.id,
							prompt: updated.prompt,
							approvalRequired: updated.approvalRequired,
						},
					},
				});
				json(response, 202, {
					success: true,
					queued: true,
					automation: updated,
					result,
				});
			} catch (e: unknown) {
				json(response, 200, {
					success: true,
					queued: false,
					automation: updated,
					message:
						"Automation saved. Agent runtime is not reachable, so it was not queued.",
					error: errorMessage(e),
				});
			}
			return;
		}

		if (request.method === "GET" && pathname === "/api/terminal/sessions") {
			const result = await api.terminalActions.list();
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/browser/providers") {
			json(response, 200, api.provider.list());
			return;
		}

		if (
			request.method === "POST" &&
			pathname === "/api/browser/providers/use"
		) {
			const body = await readJsonBody(request);
			const result = api.provider.use(asString(body.name, "name"));
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/terminal/sessions") {
			const body = await readJsonBody(request);
			const result = await api.terminal.open({
				shell: asOptionalString(body.shell),
				cwd: asOptionalString(body.cwd),
				name: asOptionalString(body.name),
			});
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/terminal/exec") {
			const body = await readJsonBody(request);
			const result = await api.terminal.exec({
				command: asString(body.command, "command"),
				sessionId: asOptionalString(body.sessionId),
				timeoutMs: asOptionalNumber(body.timeoutMs),
			});
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		const termMatch =
			/^\/api\/terminal\/sessions\/([^/]+)\/(input|read|snapshot|interrupt|status|resize)$/u.exec(
				pathname,
			);
		if (termMatch) {
			const sessionId = decodeURIComponent(termMatch[1] ?? "");
			const action = termMatch[2];
			let result: unknown;
			if (request.method === "POST" && action === "input") {
				const body = await readJsonBody(request);
				result = await api.terminal.type({
					sessionId,
					text: asString(body.text, "text"),
				});
			} else if (request.method === "POST" && action === "resize") {
				const body = await readJsonBody(request);
				const cols = Number(body.cols);
				const rows = Number(body.rows);
				const validation = validateResize(cols, rows);
				if (!validation.valid) {
					json(response, 400, {
						success: false,
						code: "bad_request",
						error: validation.error,
					});
					return;
				}
				result = await api.terminal.resize({
					sessionId,
					cols,
					rows,
				});
			} else if (request.method === "GET" && action === "read") {
				result = await api.terminal.read({
					sessionId,
					maxBytes:
						Number(requestUrl.searchParams.get("maxBytes")) || undefined,
				});
			} else if (request.method === "GET" && action === "snapshot") {
				result = await api.terminal.snapshot({ sessionId });
			} else if (request.method === "POST" && action === "interrupt") {
				result = await api.terminal.interrupt({ sessionId });
			} else if (request.method === "GET" && action === "status") {
				result = await api.terminal.status({ sessionId });
			} else {
				json(response, 405, {
					success: false,
					code: "method_not_allowed",
					error: "Method not allowed.",
				});
				return;
			}
			events.emit("terminal.action", formatActionResult(result as never));
			json(
				response,
				(result as { success?: boolean }).success ? 200 : 403,
				formatActionResult(result as never),
			);
			return;
		}

		if (
			request.method === "DELETE" &&
			pathname.startsWith("/api/terminal/sessions/")
		) {
			const sessionId = decodeURIComponent(
				pathname.slice("/api/terminal/sessions/".length),
			);
			const result = await api.terminal.close({ sessionId });
			events.emit("terminal.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/open") {
			const body = await readJsonBody(request);
			const result = await api.browser.open({
				url: asString(body.url, "url"),
				waitUntil: body.waitUntil as never,
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/snapshot") {
			const body = await readJsonBody(request);
			const result = await api.browser.snapshot({
				rootSelector: asOptionalString(body.rootSelector),
				boxes: body.boxes === true,
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/screenshot") {
			const body = await readJsonBody(request);
			const result = await api.browser.screenshot({
				outputPath: asOptionalString(body.outputPath),
				fullPage: body.fullPage === true,
				target: asOptionalString(body.target),
				annotate: body.annotate === true,
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/browser/tabs") {
			const result = await api.browser.tabList();
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/click") {
			const body = await readJsonBody(request);
			const result = await api.browser.click({
				target: asString(body.target, "target"),
				timeoutMs: asOptionalNumber(body.timeoutMs),
				force: body.force === true,
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/fill") {
			const body = await readJsonBody(request);
			const result = await api.browser.fill({
				target: asString(body.target, "target"),
				text: asString(body.text, "text"),
				timeoutMs: asOptionalNumber(body.timeoutMs),
				commit: body.commit === true,
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/press") {
			const body = await readJsonBody(request);
			const result = await api.browser.press({
				key: asString(body.key, "key"),
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/type") {
			const body = await readJsonBody(request);
			const result = await api.browser.type({
				text: asString(body.text, "text"),
				delayMs: asOptionalNumber(body.delayMs),
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/scroll") {
			const body = await readJsonBody(request);
			const result = await api.browser.scroll({
				direction: asString(body.direction, "direction") as
					| "up"
					| "down"
					| "left"
					| "right",
				amount: asOptionalNumber(body.amount),
			});
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/tabs/switch") {
			const body = await readJsonBody(request);
			const result = await api.browser.tabSwitch(asString(body.id, "id"));
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/tabs/close") {
			const result = await api.browser.tabClose();
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/browser/close") {
			const result = await api.browser.close();
			events.emit("browser.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/fs/list") {
			const result = await api.fs.ls({
				path: requestUrl.searchParams.get("path") || ".",
				recursive: requestUrl.searchParams.get("recursive") === "true",
				extension: requestUrl.searchParams.get("extension") || undefined,
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/fs/read") {
			const result = await api.fs.read({
				path: requestUrl.searchParams.get("path") || "",
				maxBytes: Number(requestUrl.searchParams.get("maxBytes")) || undefined,
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/fs/write") {
			const body = await readJsonBody(request);
			const result = await api.fs.write({
				path: asString(body.path, "path"),
				content: asString(body.content, "content"),
				createDirs: body.createDirs !== false,
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "POST" && pathname === "/api/fs/move") {
			const body = await readJsonBody(request);
			const result = await api.fs.move({
				src: asString(body.src, "src"),
				dst: asString(body.dst, "dst"),
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/fs/stat") {
			const result = await api.fs.stat({
				path: requestUrl.searchParams.get("path") || "",
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "DELETE" && pathname === "/api/fs/delete") {
			const body = await readJsonBody(request);
			const result = await api.fs.rm({
				path: asString(body.path, "path"),
				recursive: body.recursive === true,
				force: body.force === true,
			});
			events.emit("filesystem.action", formatActionResult(result));
			json(response, result.success ? 200 : 403, formatActionResult(result));
			return;
		}

		if (request.method === "GET" && pathname === "/api/tasks") {
			try {
				json(response, 200, await fetchBrokerJson("/api/v1/tasks"));
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		if (request.method === "POST" && pathname === "/api/tasks") {
			try {
				const body = await readJsonBody(request);
				rememberRequestAutomation(body, "task");
				const result = await fetchBrokerJson("/api/v1/tasks/run", {
					method: "POST",
					body,
				});
				events.emit("log.entry", {
					component: "web",
					message: "Task submitted",
					result,
				});
				json(response, 202, result);
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		const taskStatusMatch = /^\/api\/tasks\/([^/]+)$/u.exec(pathname);
		if (request.method === "GET" && taskStatusMatch) {
			try {
				const id = encodeURIComponent(
					decodeURIComponent(taskStatusMatch[1] ?? ""),
				);
				json(
					response,
					200,
					await fetchBrokerJson(`/api/v1/tasks/${id}/status`),
				);
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		if (request.method === "GET" && pathname === "/api/automations") {
			try {
				json(response, 200, await fetchBrokerJson("/api/v1/scheduler"));
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		if (request.method === "POST" && pathname === "/api/automations") {
			try {
				const body = await readJsonBody(request);
				rememberRequestAutomation(body, "user");
				const result = await fetchBrokerJson("/api/v1/tasks/schedule", {
					method: "POST",
					body,
				});
				events.emit("log.entry", {
					component: "web",
					message: "Automation scheduled",
					result,
				});
				json(response, 200, result);
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		const automationMatch =
			/^\/api\/automations\/([^/]+)\/(pause|resume)$/u.exec(pathname);
		if (request.method === "POST" && automationMatch) {
			try {
				const id = encodeURIComponent(
					decodeURIComponent(automationMatch[1] ?? ""),
				);
				const action = automationMatch[2];
				json(
					response,
					200,
					await fetchBrokerJson(`/api/v1/scheduler/${id}/${action}`, {
						method: "POST",
					}),
				);
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		const automationDeleteMatch = /^\/api\/automations\/([^/]+)$/u.exec(
			pathname,
		);
		if (request.method === "DELETE" && automationDeleteMatch) {
			try {
				const id = encodeURIComponent(
					decodeURIComponent(automationDeleteMatch[1] ?? ""),
				);
				json(
					response,
					200,
					await fetchBrokerJson(`/api/v1/scheduler/${id}`, {
						method: "DELETE",
					}),
				);
			} catch (e: unknown) {
				json(response, 503, {
					success: false,
					code: "capability_unavailable",
					error: errorMessage(e),
				});
			}
			return;
		}

		json(response, 404, {
			success: false,
			code: "not_found",
			error: "Not found.",
		});
	}

	server.on("request", async (request, response) => {
		const nonce = crypto.randomBytes(16).toString("base64");
		setSecurityHeaders(response, nonce);
		setCorsHeaders(request, response, allowedOrigins);

		if (request.method === "OPTIONS") {
			response.writeHead(204);
			response.end();
			return;
		}

		const requestUrl = new URL(
			request.url ?? "/",
			`http://${request.headers.host ?? host}`,
		);
		try {
			if (request.method === "GET" && requestUrl.pathname === "/") {
				if (!serveStatic(response, staticRoot, requestUrl.pathname))
					html(response, 200, indexHtml(nonce));
				return;
			}

			if (request.method === "GET" && requestUrl.pathname === "/healthz") {
				json(response, 200, { ok: true });
				return;
			}

			if (
				requestUrl.pathname.startsWith("/api/") &&
				!isAuthorizedRequest(request, token, requestUrl)
			) {
				json(response, 401, {
					success: false,
					code: "unauthorized",
					error: "Unauthorized.",
				});
				return;
			}

			if (requestUrl.pathname.startsWith("/api/")) {
				await handleApi(request, response, requestUrl);
				return;
			}

			if (
				request.method === "GET" &&
				serveStatic(response, staticRoot, requestUrl.pathname)
			)
				return;
			text(response, 404, "Not found.");
		} catch (error: unknown) {
			const message = redactString(
				error instanceof Error ? error.message : String(error),
			);
			json(response, 400, {
				success: false,
				code: "bad_request",
				error: message,
			});
		}
	});

	server.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(
			request.url ?? "/",
			`http://${request.headers.host ?? host}`,
		);
		if (requestUrl.pathname !== "/events") {
			socket.destroy();
			return;
		}
		events.handleUpgrade(
			request,
			socket,
			head,
			isAuthorizedRequest(request, token, requestUrl, true),
			allowedOrigins,
		);
	});

	return {
		async listen(
			listenPort = port,
			listenHost = host,
		): Promise<WebAppServerInfo> {
			assertSafeBind(listenHost, options.allowRemote === true);
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(listenPort, listenHost, () => {
					server.off("error", reject);
					resolve();
				});
			});
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("App server did not provide a TCP address.");
			webLogger.info("Listening", {
				host: listenHost,
				port: address.port,
				url: `http://${listenHost}:${address.port}`,
			});
			currentInfo = {
				host: listenHost,
				port: address.port,
				token,
				url: `http://${listenHost}:${address.port}`,
			};
			if (!options.allowedOrigins) {
				allowedOrigins = [`http://${listenHost}:${address.port}`];
			}
			return currentInfo;
		},
		async close(): Promise<void> {
			termSub.dispose();
			await events.close();
			api.close();
			if (!server.listening) return;
			if ("closeAllConnections" in server) {
				(
					server as unknown as {
						closeAllConnections: () => void;
					}
				).closeAllConnections();
			}
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						webLogger.error("Close error", { error: errorMessage(error) });
						reject(error);
					} else {
						resolve();
					}
				});
			});
		},
		address(): AddressInfo | string | null {
			return server.address();
		},
		info(): WebAppServerInfo | null {
			return currentInfo;
		},
		events,
	};
}

export async function startWebAppServer(
	options: WebAppServerOptions = {},
): Promise<WebAppServerInfo> {
	const server = createWebAppServer(options);
	const info = await server.listen();
	const shutdown = async () => {
		await server.close().catch(() => undefined);
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	return info;
}

export function openUrlInDefaultBrowser(url: string): void {
	const command =
		process.platform === "win32"
			? "cmd"
			: process.platform === "darwin"
				? "open"
				: "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
}

if (require.main === module) {
	void startWebAppServer({
		host: process.env.BROWSER_CONTROL_WEB_HOST,
		port: process.env.BROWSER_CONTROL_WEB_PORT
			? Number(process.env.BROWSER_CONTROL_WEB_PORT)
			: undefined,
		token: process.env.BROWSER_CONTROL_WEB_TOKEN,
		allowRemote: process.env.BROWSER_CONTROL_WEB_ALLOW_REMOTE === "1",
	})
		.then((info) => {
			process.stdout.write(
				`${JSON.stringify({ url: info.url, token: info.token })}\n`,
			);
		})
		.catch((error: unknown) => {
			webLogger.critical("Fatal startup error", { error: errorMessage(error) });
			process.exitCode = 1;
		});
}
