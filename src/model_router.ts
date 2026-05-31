import crypto from "node:crypto";
import http from "node:http";
import { redactString } from "./observability/redaction";
import { constantTimeTokenEqual } from "./shared/auth";
import { logger } from "./shared/logger";
import { getConfigValue, setUserConfigValue, loadUserConfig } from "./shared/config";

const log = logger.withComponent("model-router");
let warnedOpenRouterConfigOverlap = false;

// ── Types ───────────────────────────────────────────────────────────

export type ModelProviderKind = "openrouter" | "ollama" | "openai-compatible";

export interface ModelProvider {
	kind: ModelProviderKind;
	name: string;
	baseUrl: string;
	apiKey?: string;
	model: string;
	priority: number;
	enabled: boolean;
	costPerToken?: number;
}

export interface RouterConfig {
	providers: ModelProvider[];
	localOnlyMode: boolean;
	costCapUsd: number;
	localApiPort: number;
	localApiToken: string;
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatRequest { model?: string; messages: ChatMessage[]; temperature?: number; max_tokens?: number; }
export interface ChatResponse { id: string; object: string; created: number; model: string; choices: Array<{ index: number; message: ChatMessage; finish_reason: string; }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; }; }

// ── Default Providers ────────────────────────────────────────────────

function defaultProviders(): ModelProvider[] {
	return [
		{ kind: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o", priority: 1, enabled: false },
		{ kind: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3", priority: 2, enabled: false },
		{ kind: "openai-compatible", name: "Custom", baseUrl: "http://localhost:8080/v1", model: "", priority: 3, enabled: false },
	];
}

export function getDefaultProviders(): ModelProvider[] {
	const providers = defaultProviders();
	const userConfig = (() => {
		try {
			return loadUserConfig() as Record<string, unknown>;
		} catch {
			return {};
		}
	})();
	// Use loadUserConfig for sensitive values (API keys) to avoid redaction.
	// Use getConfigValue for non-sensitive values.
	const getRawString = (key: string): string | undefined => {
		const value = userConfig[key];
		return typeof value === "string" && value.trim() ? value : undefined;
	};
	const getString = (key: string): string | undefined => {
		try {
			const value = getConfigValue(key, { validate: false }).value;
			return typeof value === "string" && value.trim() && value !== "[redacted]" ? value : undefined;
		} catch {
			return undefined;
		}
	};
	const selected = getString("modelProvider") ?? "openrouter";
	const endpoint = getString("modelEndpoint");
	const apiKey = getRawString("modelApiKey");
	const modelName = getString("modelName");
	const explicitOpenRouterOverlaps = [
		modelName && (getRawString("openrouterModel") || process.env.OPENROUTER_MODEL || process.env.AI_AGENT_MODEL)
			? "modelName overrides openrouterModel"
			: undefined,
		endpoint && (getRawString("openrouterBaseUrl") || process.env.OPENROUTER_BASE_URL)
			? "modelEndpoint overrides openrouterBaseUrl"
			: undefined,
		apiKey && (getRawString("openrouterApiKey") || process.env.OPENROUTER_API_KEY)
			? "modelApiKey overrides openrouterApiKey"
			: undefined,
	].filter((entry): entry is string => Boolean(entry));

	if (selected === "openrouter" && explicitOpenRouterOverlaps.length > 0 && !warnedOpenRouterConfigOverlap) {
		warnedOpenRouterConfigOverlap = true;
		log.warn(
			"Both canonical model* settings and legacy openrouter* settings are configured; canonical model* settings take precedence.",
			{ precedence: explicitOpenRouterOverlaps },
		);
	}

	return providers.map(provider => {
		const enabled = provider.kind === selected;
		if (provider.kind === "openrouter") {
			return {
				...provider,
				enabled,
				apiKey: apiKey ?? getRawString("openrouterApiKey"),
				model: modelName ?? getString("openrouterModel") ?? provider.model,
				baseUrl: endpoint ?? getString("openrouterBaseUrl") ?? provider.baseUrl,
			};
		}
		if (provider.kind === "openai-compatible") {
			return {
				...provider,
				enabled,
				apiKey,
				model: modelName ?? provider.model,
				baseUrl: endpoint ?? provider.baseUrl,
			};
		}
		if (provider.kind === "ollama") {
			return {
				...provider,
				enabled,
				model: modelName ?? provider.model,
				baseUrl: endpoint ?? provider.baseUrl,
			};
		}
		return { ...provider, enabled };
	});
}

export function saveProviders(providers: ModelProvider[]): void {
	const firstEnabled = [...providers]
		.filter(provider => provider.enabled)
		.sort((a, b) => a.priority - b.priority)[0];
	if (!firstEnabled) return;
	setUserConfigValue("modelProvider", firstEnabled.kind);
	setUserConfigValue("modelEndpoint", firstEnabled.baseUrl);
	setUserConfigValue("modelName", firstEnabled.model);
	if (firstEnabled.apiKey) setUserConfigValue("modelApiKey", firstEnabled.apiKey);
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase();
		return (
			hostname === "localhost" ||
			hostname === "::1" ||
			hostname === "[::1]" ||
			hostname === "127.0.0.1" ||
			hostname.startsWith("127.")
		);
	} catch {
		return false;
	}
}

function isLoopbackRemoteAddress(address: string | undefined): boolean {
	if (!address) return false;
	const normalized = address.toLowerCase();
	return (
		normalized === "127.0.0.1" ||
		normalized === "::1" ||
		normalized === "::ffff:127.0.0.1" ||
		normalized.startsWith("127.")
	);
}

// ── Router ──────────────────────────────────────────────────────────

export class ModelRouter {
	private providers: ModelProvider[];
	private costCap: number;
	private localOnly: boolean;
	private totalCost = 0;

	constructor(config?: Partial<RouterConfig>) {
		this.providers = config?.providers ?? getDefaultProviders();
		this.costCap = config?.costCapUsd ?? 1.0;
		this.localOnly = config?.localOnlyMode ?? false;
	}

	getActiveProviders(): ModelProvider[] {
		return this.providers
			.filter(p => p.enabled)
			.filter(
				p =>
					!this.localOnly ||
					((p.kind === "ollama" || p.kind === "openai-compatible") &&
						isLoopbackBaseUrl(p.baseUrl)),
			)
			.sort((a, b) => a.priority - b.priority);
	}

	async chat(request: ChatRequest): Promise<ChatResponse> {
		const active = this.getActiveProviders();
		if (active.length === 0) throw new Error("No enabled model providers");

		let lastError: Error | null = null;
		for (const provider of active) {
			try {
				if (this.totalCost >= this.costCap) throw new Error(`Cost cap reached: $${this.totalCost.toFixed(4)} >= $${this.costCap}`);
				const result = await this.callProvider(provider, request);
				const cost = this.estimateCost(result);
				this.totalCost += cost;
				return result;
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e));
				log.warn(`Provider ${provider.name} failed: ${lastError.message}, trying next`);
			}
		}

		throw lastError ?? new Error("All providers failed");
	}

	private async callProvider(provider: ModelProvider, request: ChatRequest): Promise<ChatResponse> {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;
		if (provider.kind === "openrouter") {
			headers["HTTP-Referer"] = "http://localhost";
			headers["X-Title"] = "Browser Control";
		}

		const model = request.model || provider.model;
		const body = JSON.stringify({ ...request, model, stream: false });
		const baseUrl = provider.baseUrl.replace(/\/+$/u, "");

		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST", headers, body,
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				redactString(
					`Provider ${provider.name} returned ${response.status}: ${text.substring(0, 200)}`,
				),
			);
		}

		return response.json() as Promise<ChatResponse>;
	}

	private estimateCost(response: ChatResponse): number {
		const tokens = response.usage?.total_tokens ?? 0;
		return tokens * 0.000002; // conservative estimate
	}

	getTotalCost(): number { return this.totalCost; }
	resetCost(): void { this.totalCost = 0; }
}

// ── Local OpenAI-Compatible API ─────────────────────────────────────

export interface LocalApiConfig {
	port?: number;
	token?: string;
	allowRemote?: boolean;
	router?: ModelRouter;
	maxBodyBytes?: number;
	requestTimeoutMs?: number;
}

const DEFAULT_LOCAL_API_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_LOCAL_API_REQUEST_TIMEOUT_MS = 30_000;

class LocalApiRequestError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
	) {
		super(message);
		this.name = "LocalApiRequestError";
	}
}

export async function startLocalApi(
	config: LocalApiConfig = {},
): Promise<{ server: http.Server; url: string; token: string }> {
	const port = config.port ?? 11435;
	const token = config.token ?? crypto.randomBytes(16).toString("hex");
	const router = config.router ?? new ModelRouter();
	const host = config.allowRemote ? "0.0.0.0" : "127.0.0.1";
	const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_LOCAL_API_MAX_BODY_BYTES;
	const requestTimeoutMs =
		config.requestTimeoutMs ?? DEFAULT_LOCAL_API_REQUEST_TIMEOUT_MS;

	const server = http.createServer(async (req, res) => {
		res.setHeader("Content-Type", "application/json");
		const pathname = (req.url ?? "/").replace(/^\/+/, "/").split("?")[0] ?? "/";

		if (!config.allowRemote && !isLoopbackRemoteAddress(req.socket.remoteAddress)) {
			res.writeHead(403);
			res.end(JSON.stringify({ error: "Loopback only" }));
			return;
		}

		const auth = req.headers.authorization;
		if (!constantTimeTokenEqual(auth, `Bearer ${token}`)) {
			res.writeHead(401);
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

		if (req.method === "GET" && pathname === "/v1/models") {
			const active = router.getActiveProviders();
			res.writeHead(200);
			res.end(JSON.stringify({ object: "list", data: active.map(p => ({ id: p.model, object: "model", owned_by: p.name })) }));
			return;
		}

		if (req.method === "POST" && pathname === "/v1/chat/completions") {
			try {
				const body = await readBody(req, { maxBodyBytes, requestTimeoutMs });
				const request: ChatRequest = JSON.parse(body);
				const response = await router.chat(request);
				res.writeHead(200);
				res.end(JSON.stringify(response));
			} catch (e) {
				const statusCode =
					e instanceof LocalApiRequestError ? e.statusCode : 500;
				res.writeHead(statusCode, {
					...(e instanceof LocalApiRequestError
						? { Connection: "close" }
						: {}),
				});
				res.end(JSON.stringify({ error: e instanceof Error ? redactString(e.message) : "Unknown error" }));
				if (e instanceof LocalApiRequestError) req.destroy();
			}
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not found" }));
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
	const address = server.address();
	const actualPort =
		address && typeof address === "object" ? address.port : port;
	const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actualPort}`;
	log.info(`Local API listening at ${url}`);
	return { server, url, token };
}

function readBody(
	req: http.IncomingMessage,
	options: { maxBodyBytes: number; requestTimeoutMs: number },
): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let receivedBytes = 0;
		let settled = false;
		const cleanup = () => {
			clearTimeout(timeout);
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("error", onError);
			req.off("aborted", onAborted);
		};
		const rejectBody = (error: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			req.pause();
			reject(error);
		};
		const onData = (chunk: Buffer) => {
			receivedBytes += chunk.length;
			if (receivedBytes > options.maxBodyBytes) {
				rejectBody(new LocalApiRequestError("Request body too large", 413));
				return;
			}
			chunks.push(Buffer.from(chunk));
		};
		const onEnd = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(Buffer.concat(chunks).toString());
		};
		const onError = (error: Error) => {
			rejectBody(new LocalApiRequestError(error.message, 400));
		};
		const onAborted = () => {
			rejectBody(new LocalApiRequestError("Request body aborted", 400));
		};
		const timeout = setTimeout(() => {
			rejectBody(new LocalApiRequestError("Request body timed out", 408));
		}, options.requestTimeoutMs);
		timeout.unref?.();
		req.on("data", onData);
		req.on("end", onEnd);
		req.on("error", onError);
		req.on("aborted", onAborted);
	});
}

// ── Doctor Checks ───────────────────────────────────────────────────

export async function checkOllamaReachable(): Promise<{ ok: boolean; message: string }> {
	try {
		const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
		if (res.ok) return { ok: true, message: "Ollama reachable" };
		return { ok: false, message: `Ollama returned ${res.status}` };
	} catch {
		return { ok: false, message: "Ollama not reachable" };
	}
}

export async function checkOpenRouterKey(): Promise<{ ok: boolean; message: string }> {
	const userConfig = loadUserConfig();
	const key = (userConfig as Record<string, unknown>).openrouterApiKey ?? (userConfig as Record<string, unknown>).modelApiKey;
	if (typeof key !== "string" || !key.trim()) return { ok: false, message: "OpenRouter API key not configured" };
	return { ok: true, message: "OpenRouter API key configured" };
}

export async function checkCustomEndpoint(endpoint: string): Promise<{ ok: boolean; message: string }> {
	try {
		const res = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(3000) });
		if (res.ok) return { ok: true, message: `Endpoint reachable: ${endpoint}` };
		return { ok: false, message: `Endpoint returned ${res.status}` };
	} catch {
		return { ok: false, message: `Endpoint not reachable: ${endpoint}` };
	}
}
