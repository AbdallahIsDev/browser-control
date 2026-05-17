import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { ModelRouter, startLocalApi } from "../../src/model_router";
import type { ChatRequest, ChatResponse } from "../../src/model_router";

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
