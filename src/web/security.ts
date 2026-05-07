import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization, X-API-Key";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function createLocalToken(): string {
	return crypto.randomBytes(32).toString("base64url");
}

export function isLoopbackHost(host: string): boolean {
	return LOOPBACK_HOSTS.has(host);
}

export function assertSafeBind(host: string, allowRemote: boolean): void {
	if (isLoopbackHost(host)) return;
	if (!allowRemote) {
		throw new Error(
			`Refusing to bind Browser Control app server to non-loopback host "${host}" without allowRemote.`,
		);
	}
}

export function setSecurityHeaders(
	response: ServerResponse,
	nonce?: string,
): void {
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("Referrer-Policy", "no-referrer");
	response.setHeader(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);
	response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
	response.setHeader("X-Frame-Options", "DENY");
	const csp = `default-src 'self'; script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none';`;
	response.setHeader("Content-Security-Policy", csp);
}

export function setCorsHeaders(
	request: IncomingMessage,
	response: ServerResponse,
	allowedOrigins: string[],
): void {
	const origin =
		typeof request.headers.origin === "string" ? request.headers.origin : "";
	if (origin && allowedOrigins.includes(origin)) {
		response.setHeader("Access-Control-Allow-Origin", origin);
		response.setHeader("Vary", "Origin");
	}
	response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
	response.setHeader("Access-Control-Allow-Headers", DEFAULT_ALLOWED_HEADERS);
}

export function extractAuthToken(
	request: IncomingMessage,
	requestUrl?: URL,
	allowQueryToken = false,
): string | null {
	const apiKey = request.headers["x-api-key"];
	if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();

	const authorization = request.headers.authorization;
	const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
	if (match?.[1]?.trim()) return match[1].trim();

	const token = allowQueryToken ? requestUrl?.searchParams.get("token") : null;
	return token?.trim() || null;
}

export function isBrowserOriginRequest(request: IncomingMessage): boolean {
	return (
		typeof request.headers.origin === "string" &&
		request.headers.origin.trim().length > 0
	);
}

export function isAuthorizedRequest(
	request: IncomingMessage,
	token: string,
	requestUrl?: URL,
	allowQueryToken = false,
): boolean {
	return extractAuthToken(request, requestUrl, allowQueryToken) === token;
}

export async function readJsonBody(
	request: IncomingMessage,
	maxBytes = 1024 * 1024,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.byteLength;
		if (totalBytes > maxBytes) {
			throw new Error(
				`Request body too large. Maximum size is ${maxBytes} bytes.`,
			);
		}
		chunks.push(buffer);
	}

	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (!raw) return {};

	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Request body must be a JSON object.");
	}
	return parsed as Record<string, unknown>;
}
