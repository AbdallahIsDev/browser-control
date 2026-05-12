import crypto from "node:crypto";
import http from "node:http";
import { logger } from "./shared/logger";
import { getConfigValue, setUserConfigValue } from "./shared/config";

const log = logger.withComponent("model-router");

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
	const stored = getConfigValue("modelProviders")?.value;
	if (Array.isArray(stored)) return stored as unknown as ModelProvider[];
	return defaultProviders();
}

export function saveProviders(providers: ModelProvider[]): void {
	setUserConfigValue("modelProviders", providers);
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
			.filter(p => !this.localOnly || p.kind === "ollama" || p.kind === "openai-compatible")
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

		const response = await fetch(`${provider.baseUrl}/chat/completions`, {
			method: "POST", headers, body,
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Provider ${provider.name} returned ${response.status}: ${text.substring(0, 200)}`);
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
}

export function startLocalApi(config: LocalApiConfig = {}): { server: http.Server; url: string; token: string } {
	const port = config.port ?? 11435;
	const token = config.token ?? crypto.randomBytes(16).toString("hex");
	const router = config.router ?? new ModelRouter();
	const host = config.allowRemote ? "0.0.0.0" : "127.0.0.1";

	const server = http.createServer(async (req, res) => {
		res.setHeader("Content-Type", "application/json");

		if (!config.allowRemote && req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::1") {
			res.writeHead(403);
			res.end(JSON.stringify({ error: "Loopback only" }));
			return;
		}

		const auth = req.headers.authorization;
		if (!auth || auth !== `Bearer ${token}`) {
			res.writeHead(401);
			res.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}

		if (req.method === "GET" && req.url === "/v1/models") {
			const active = router.getActiveProviders();
			res.writeHead(200);
			res.end(JSON.stringify({ object: "list", data: active.map(p => ({ id: p.model, object: "model", owned_by: p.name })) }));
			return;
		}

		if (req.method === "POST" && req.url === "/v1/chat/completions") {
			try {
				const body = await readBody(req);
				const request: ChatRequest = JSON.parse(body);
				const response = await router.chat(request);
				res.writeHead(200);
				res.end(JSON.stringify(response));
			} catch (e) {
				res.writeHead(500);
				res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }));
			}
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not found" }));
	});

	server.listen(port, host);
	const url = `http://${host}:${port}`;
	log.info(`Local API listening at ${url}`);
	return { server, url, token };
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString()));
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
	const key = getConfigValue("openrouterApiKey")?.value as string | undefined;
	if (!key) return { ok: false, message: "OpenRouter API key not configured" };
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
