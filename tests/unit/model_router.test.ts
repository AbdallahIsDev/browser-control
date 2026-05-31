import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getDefaultProviders, ModelRouter, startLocalApi } from "../../src/model_router";
import type { ChatRequest, ChatResponse } from "../../src/model_router";
import { saveUserConfig } from "../../src/shared/config";

async function startJsonServer(
	handler: (req: http.IncomingMessage, body: string) => {
		status: number;
		body: unknown;
	},
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", chunk => chunks.push(Buffer.from(chunk)));
		req.on("end", () => {
			const result = handler(req, Buffer.concat(chunks).toString("utf8"));
			res.writeHead(result.status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result.body));
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	return {
		server,
		url: `http://127.0.0.1:${address.port}/v1`,
		close: () => new Promise(resolve => server.close(() => resolve())),
	};
}

function chatResponse(model: string): ChatResponse {
	return {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 1,
		model,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "ok" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
}

test("ModelRouter falls back to next enabled provider after provider failure", async () => {
	const failing = await startJsonServer(() => ({
		status: 500,
		body: { error: "forced failure" },
	}));
	const passing = await startJsonServer((_req, body) => {
		const parsed = JSON.parse(body) as ChatRequest;
		return { status: 200, body: chatResponse(parsed.model ?? "fallback") };
	});

	try {
		const router = new ModelRouter({
			providers: [
				{
					kind: "openai-compatible",
					name: "Primary",
					baseUrl: failing.url,
					model: "primary-model",
					priority: 1,
					enabled: true,
				},
				{
					kind: "openai-compatible",
					name: "Fallback",
					baseUrl: passing.url,
					model: "fallback-model",
					priority: 2,
					enabled: true,
				},
			],
		});

		const response = await router.chat({
			messages: [{ role: "user", content: "hello" }],
		});

		assert.equal(response.model, "fallback-model");
	} finally {
		await failing.close();
		await passing.close();
	}
});

test("ModelRouter local-only mode excludes remote OpenAI-compatible endpoints", () => {
	const router = new ModelRouter({
		localOnlyMode: true,
		providers: [
			{
				kind: "openrouter",
				name: "OpenRouter",
				baseUrl: "https://openrouter.ai/api/v1",
				model: "remote",
				priority: 1,
				enabled: true,
			},
			{
				kind: "openai-compatible",
				name: "Remote Custom",
				baseUrl: "https://api.example.com/v1",
				model: "remote-custom",
				priority: 2,
				enabled: true,
			},
			{
				kind: "openai-compatible",
				name: "Loopback Custom",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "local-custom",
				priority: 3,
				enabled: true,
			},
		],
	});

	assert.deepEqual(
		router.getActiveProviders().map(provider => provider.name),
		["Loopback Custom"],
	);
});

test("default model providers warn and prefer canonical model config over legacy OpenRouter keys", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "bc-model-router-"));
	const envKeys = [
		"BROWSER_CONTROL_HOME",
		"BROWSER_CONTROL_MODEL_PROVIDER",
		"BROWSER_CONTROL_MODEL_ENDPOINT",
		"BROWSER_CONTROL_MODEL_API_KEY",
		"BROWSER_CONTROL_MODEL_NAME",
		"OPENROUTER_MODEL",
		"AI_AGENT_MODEL",
		"OPENROUTER_BASE_URL",
		"OPENROUTER_API_KEY",
	] as const;
	const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>;
	const originalWrite = process.stdout.write;
	let output = "";

	try {
		for (const key of envKeys) delete process.env[key];
		process.env.BROWSER_CONTROL_HOME = home;
		saveUserConfig({
			modelProvider: "openrouter",
			modelName: "canonical-model",
			modelEndpoint: "https://canonical.example/v1",
			modelApiKey: "canonical-key",
			openrouterModel: "legacy-model",
			openrouterBaseUrl: "https://legacy.example/v1",
			openrouterApiKey: "legacy-key",
		}, { env: process.env });
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
			return true;
		}) as typeof process.stdout.write;

		const openrouter = getDefaultProviders().find(provider => provider.kind === "openrouter");

		assert.equal(openrouter?.model, "canonical-model");
		assert.equal(openrouter?.baseUrl, "https://canonical.example/v1");
		assert.equal(openrouter?.apiKey, "canonical-key");
		assert.match(output, /canonical model\* settings take precedence/u);
		assert.doesNotMatch(output, /canonical-key|legacy-key/u);
	} finally {
		process.stdout.write = originalWrite;
		for (const key of envKeys) {
			if (originalEnv[key] === undefined) delete process.env[key];
			else process.env[key] = originalEnv[key];
		}
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("local OpenAI-compatible API reports actual port and requires bearer auth", async () => {
	const upstream = await startJsonServer((_req, body) => {
		const parsed = JSON.parse(body) as ChatRequest;
		return { status: 200, body: chatResponse(parsed.model ?? "local-model") };
	});
	const router = new ModelRouter({
		providers: [
			{
				kind: "openai-compatible",
				name: "Fixture",
				baseUrl: upstream.url,
				model: "fixture-model",
				priority: 1,
				enabled: true,
			},
		],
	});
	const { server, url, token } = await startLocalApi({ port: 0, token: "test-token", router });

	try {
		assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/u);
		assert.doesNotMatch(url, /:0$/u);

		const unauthorized = await fetch(`${url}/v1/models`);
		assert.equal(unauthorized.status, 401);

		const models = await fetch(`${url}/v1/models`, {
			headers: { authorization: `Bearer ${token}` },
		});
		assert.equal(models.status, 200);

		const chat = await fetch(`${url}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});
		assert.equal(chat.status, 200);
		const payload = (await chat.json()) as ChatResponse;
		assert.equal(payload.model, "fixture-model");
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
		await upstream.close();
	}
});

test("local OpenAI-compatible API checks bearer auth with timing-safe comparison", async () => {
	const router = new ModelRouter({
		providers: [
			{
				kind: "openai-compatible",
				name: "Fixture",
				baseUrl: "http://127.0.0.1:9/v1",
				model: "fixture-model",
				priority: 1,
				enabled: true,
			},
		],
	});
	const originalTimingSafeEqual = crypto.timingSafeEqual;
	let timingSafeEqualCalls = 0;
	Object.defineProperty(crypto, "timingSafeEqual", {
		configurable: true,
		value: ((left: NodeJS.ArrayBufferView, right: NodeJS.ArrayBufferView) => {
			timingSafeEqualCalls += 1;
			return originalTimingSafeEqual(left, right);
		}) satisfies typeof crypto.timingSafeEqual,
	});
	let server: http.Server | undefined;

	try {
		const api = await startLocalApi({ port: 0, token: "test-token", router });
		server = api.server;
		const models = await fetch(`${api.url}/v1/models`, {
			headers: { authorization: `Bearer ${api.token}` },
		});
		assert.equal(models.status, 200);
		assert.ok(timingSafeEqualCalls > 0);
	} finally {
		Object.defineProperty(crypto, "timingSafeEqual", {
			configurable: true,
			value: originalTimingSafeEqual,
		});
		const startedServer = server;
		if (startedServer) {
			await new Promise<void>(resolve => startedServer.close(() => resolve()));
		}
	}
});

test("local OpenAI-compatible API uses OS-assigned port for port 0", async () => {
	const router = new ModelRouter({
		providers: [
			{
				kind: "openai-compatible",
				name: "Fixture",
				baseUrl: "http://127.0.0.1:9/v1",
				model: "fixture-model",
				priority: 1,
				enabled: true,
			},
		],
	});
	const first = await startLocalApi({ port: 0, token: "test-token-a", router });
	const second = await startLocalApi({ port: 0, token: "test-token-b", router });

	try {
		assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
		assert.match(second.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
		assert.notEqual(first.url, second.url);
		assert.doesNotMatch(first.url, /:0$/u);
		assert.doesNotMatch(second.url, /:0$/u);
	} finally {
		await Promise.all([
			new Promise<void>(resolve => first.server.close(() => resolve())),
			new Promise<void>(resolve => second.server.close(() => resolve())),
		]);
	}
});

test("local OpenAI-compatible API redacts provider error text", async () => {
	const secret = "sk-test-model-router-secret-123456789";
	const upstream = await startJsonServer(() => ({
		status: 500,
		body: { error: `api_key=${secret}` },
	}));
	const router = new ModelRouter({
		providers: [
			{
				kind: "openai-compatible",
				name: "Fixture",
				baseUrl: upstream.url,
				apiKey: secret,
				model: "fixture-model",
				priority: 1,
				enabled: true,
			},
		],
	});
	const { server, url, token } = await startLocalApi({ port: 0, token: "test-token", router });

	try {
		const response = await fetch(`${url}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});
		assert.equal(response.status, 500);
		const text = await response.text();
		assert.doesNotMatch(text, new RegExp(secret));
		assert.match(text, /\[REDACTED\]/u);
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
		await upstream.close();
	}
});
