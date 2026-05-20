import type { Page } from "playwright";
import { redactObject, redactString } from "../observability/redaction";
import {
	type ActionResult,
	failureResult,
	successResult,
} from "../shared/action_result";

const MAX_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 100_000;

const METHOD_REGEX = /^[A-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/u;

const DANGEROUS_METHODS = new Set([
	"Browser.close",
	"Browser.crash",
	"Browser.setWindowBounds",
	"Target.closeTarget",
	"Target.createTarget",
	"Page.navigate",
	"Page.captureScreenshot",
	"Page.printToPDF",
	"Page.setDeviceMetricsOverride",
	"Page.setDownloadBehavior",
	"Security.disable",
	"Security.setIgnoreCertificateErrors",
	"Fetch.enable",
	"Fetch.continueResponse",
	"Fetch.continueRequest",
	"Fetch.fulfillRequest",
	"Fetch.failRequest",
	"Storage.clearDataForOrigin",
	"Network.setCookie",
	"Network.deleteCookies",
	"Runtime.evaluate",
]);

function isJsonSerializable(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
	if (Array.isArray(value)) return value.every(isJsonSerializable);
	if (typeof value === "object") {
		return Object.values(value as Record<string, unknown>).every(isJsonSerializable);
	}
	return false;
}

function truncateOutput(result: unknown): unknown {
	const raw = JSON.stringify(result);
	if (raw.length <= MAX_OUTPUT_CHARS) return result;
	const truncated = raw.slice(0, MAX_OUTPUT_CHARS);
	try {
		return JSON.parse(truncated) as unknown;
	} catch {
		return { _truncated: true, _length: raw.length, _preview: truncated.slice(0, 1000) };
	}
}

export interface CdpOptions {
	method: string;
	params?: Record<string, unknown>;
	targetId?: string;
	frameId?: string;
	timeoutMs: number;
	tabId?: string;
}

export async function executeCdpCommand(
	page: Page,
	options: CdpOptions,
	sessionId?: string,
): Promise<ActionResult<{ result: unknown }>> {
	const { method, params, targetId, frameId, timeoutMs } = options;
	const sid = sessionId ?? "default";

	if (!METHOD_REGEX.test(method)) {
		return failureResult(
			`Invalid CDP method format: "${method}". Must match "Domain.method" pattern.`,
			{ path: "low_level", sessionId: sid },
		);
	}

	if (DANGEROUS_METHODS.has(method)) {
		return failureResult(
			`CDP method "${method}" is blocked for security reasons.`,
			{ path: "low_level", sessionId: sid },
		);
	}

	if (params !== undefined && !isJsonSerializable(params)) {
		return failureResult(
			"CDP params must be JSON-serializable (plain objects, arrays, strings, numbers, booleans, null).",
			{ path: "low_level", sessionId: sid },
		);
	}

	if (targetId !== undefined) {
		return failureResult(
			`targetId targeting is not supported in the current page-scoped CDP implementation. Specified targetId: "${targetId}". Omit targetId to use the current page's CDP session.`,
			{ path: "low_level", sessionId: sid },
		);
	}

	if (frameId !== undefined) {
		return failureResult(
			`frameId targeting is not supported in the current page-scoped CDP implementation. Specified frameId: "${frameId}". Omit frameId to use the current page's CDP session.`,
			{ path: "low_level", sessionId: sid },
		);
	}

	if (typeof timeoutMs !== "number" || timeoutMs < 0) {
		return failureResult(
			`timeoutMs is required and must be a non-negative number.`,
			{ path: "low_level", sessionId: sid },
		);
	}

	const effectiveTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

	try {
		const client = await page.context().newCDPSession(page);

		const timeoutSignal = AbortSignal.timeout(effectiveTimeout);

		const result = await Promise.race([
			client.send(method as any, (params ?? {}) as any),
			new Promise<never>((_, reject) => {
				timeoutSignal.addEventListener("abort", () => {
					reject(new Error(`CDP command timed out after ${effectiveTimeout}ms`));
				});
			}),
		]);

		await client.detach().catch(() => undefined);

		const redacted = redactObject(truncateOutput(result));
		const redactedStr =
			typeof redacted === "string"
				? redactString(redacted)
				: redactString(JSON.stringify(redacted));

		let finalResult: unknown;
		try {
			finalResult = JSON.parse(redactedStr) as unknown;
		} catch {
			finalResult = { _redacted: true, _raw: redactedStr.slice(0, 2000) };
		}

		return successResult(
			{ result: finalResult },
			{ path: "low_level", sessionId: sid },
		);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		const redactedMessage = redactString(message);
		return failureResult(`CDP command failed: ${redactedMessage}`, {
			path: "low_level",
			sessionId: sid,
		});
	}
}
