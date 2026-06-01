import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { redactObject } from "../observability/redaction";
import { constantTimeTokenEqual } from "../shared/auth";
import type { WebAppEvent, WebEventKind } from "./types";

const MAX_RECENT_EVENTS = 200;
const MAX_SUBSCRIPTION_CHANNELS = 100;
const MAX_CHANNEL_LENGTH = 128;
const DEFAULT_MAX_CLIENT_BUFFERED_BYTES = 1_000_000;
const DEFAULT_SEND_TIMEOUT_MS = 5_000;

interface WebEventHubOptions {
	maxBufferedBytes?: number;
	sendTimeoutMs?: number;
}

interface ClientEventFilter {
	sessionId?: string;
	channels?: Set<string>;
}

function writeUpgradeError(
	socket: Duplex,
	statusCode: number,
	message: string,
): void {
	socket.write(
		[
			`HTTP/1.1 ${statusCode} Error`,
			"Content-Type: application/json",
			"Connection: close",
			"",
			JSON.stringify({ error: message }),
		].join("\r\n"),
	);
	socket.destroy();
}

export class WebEventHub {
	private readonly wss = new WebSocketServer({ noServer: true });
	private readonly recent: WebAppEvent[] = [];
	private readonly clientFilters = new WeakMap<WebSocket, ClientEventFilter>();
	private readonly sendTimeouts = new Set<NodeJS.Timeout>();
	private readonly maxBufferedBytes: number;
	private readonly sendTimeoutMs: number;
	private nextId = 1;

	constructor(options: WebEventHubOptions = {}) {
		this.maxBufferedBytes =
			options.maxBufferedBytes ?? DEFAULT_MAX_CLIENT_BUFFERED_BYTES;
		this.sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	}

	handleUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		authorized: boolean,
		allowedOrigins: string[] = [],
		token?: string,
	): void {
		const origin = request.headers.origin;
		if (
			typeof origin === "string" &&
			origin.length > 0 &&
			allowedOrigins.length > 0 &&
			!allowedOrigins.includes(origin)
		) {
			writeUpgradeError(socket, 403, "Forbidden Origin.");
			return;
		}

		// Check Sec-WebSocket-Protocol header for token auth
		// (keeps token out of query strings, logs, and proxies)
		if (!authorized && token) {
			const protocol = request.headers["sec-websocket-protocol"];
			if (typeof protocol === "string") {
				const protocols = protocol.split(",").map((s) => s.trim());
				if (
					protocols.some((candidate) =>
						constantTimeTokenEqual(candidate, token),
					)
				) {
					authorized = true;
				}
			}
		}

		if (!authorized) {
			writeUpgradeError(socket, 401, "Unauthorized.");
			return;
		}
		const filter = this.parseFilter(request);
		this.wss.handleUpgrade(request, socket, head, (client) => {
			this.clientFilters.set(client, filter);
			client.on("message", (data) => this.handleClientMessage(client, data));
			client.once("close", () => this.clientFilters.delete(client));
			this.wss.emit("connection", client, request);
			this.sendToClient(
				client,
				JSON.stringify({
					type: "runtime.status",
					replay: true,
					events: this.filterRecent(filter),
				}),
			);
		});
	}

	emit<T>(
		type: WebEventKind,
		payload: T,
		options: { sessionId?: string; actionId?: string } = {},
	): WebAppEvent {
		const sessionId = options.sessionId ?? this.payloadSessionId(payload);
		const event: WebAppEvent = {
			id: `evt-${this.nextId++}`,
			type,
			timestamp: new Date().toISOString(),
			...(sessionId ? { sessionId } : {}),
			...(options.actionId ? { actionId: options.actionId } : {}),
			payload: redactObject(payload),
		};
		this.recent.push(event);
		while (this.recent.length > MAX_RECENT_EVENTS) this.recent.shift();

		const raw = JSON.stringify(event);
		for (const client of this.wss.clients) {
			if (
				client.readyState === WebSocket.OPEN &&
				this.matchesFilter(client, event)
			) {
				this.sendToClient(client, raw);
			}
		}
		return event;
	}

	private parseFilter(request: IncomingMessage): ClientEventFilter {
		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const sessionId = requestUrl.searchParams.get("sessionId")?.trim();
		return sessionId ? { sessionId } : {};
	}

	private filterRecent(filter: ClientEventFilter): WebAppEvent[] {
		if (!filter.sessionId) return this.recent;
		return this.recent.filter((event) => event.sessionId === filter.sessionId);
	}

	private matchesFilter(client: WebSocket, event: WebAppEvent): boolean {
		const filter = this.clientFilters.get(client);
		if (filter?.channels) {
			return this.eventChannels(event).some((channel) =>
				filter.channels?.has(channel),
			);
		}
		return !filter?.sessionId || event.sessionId === filter.sessionId;
	}

	private handleClientMessage(client: WebSocket, data: RawData): void {
		const parsed = this.parseSubscriptionMessage(data);
		if (!parsed.ok) {
			this.sendToClient(
				client,
				JSON.stringify({ type: "subscription.error", error: parsed.error }),
			);
			return;
		}

		const current = this.clientFilters.get(client) ?? {};
		const channels = new Set(current.channels ?? []);
		if (parsed.type === "subscribe") {
			for (const channel of parsed.channels) channels.add(channel);
		} else if (parsed.channels.length === 0) {
			channels.clear();
		} else {
			for (const channel of parsed.channels) channels.delete(channel);
		}

		const next: ClientEventFilter = {
			...(current.sessionId ? { sessionId: current.sessionId } : {}),
			...(channels.size > 0 ? { channels } : {}),
		};
		this.clientFilters.set(client, next);
		this.sendToClient(
			client,
			JSON.stringify({
				type: "subscription.updated",
				channels: Array.from(channels).sort(),
			}),
		);
	}

	private parseSubscriptionMessage(
		data: RawData,
	):
		| { ok: true; type: "subscribe" | "unsubscribe"; channels: string[] }
		| { ok: false; error: string } {
		let payload: unknown;
		try {
			payload = JSON.parse(data.toString());
		} catch {
			return { ok: false, error: "Message must be valid JSON." };
		}
		if (!payload || typeof payload !== "object") {
			return { ok: false, error: "Message must be a JSON object." };
		}
		const record = payload as Record<string, unknown>;
		if (record.type !== "subscribe" && record.type !== "unsubscribe") {
			return {
				ok: false,
				error: "Message type must be subscribe or unsubscribe.",
			};
		}
		if (!Array.isArray(record.channels)) {
			return { ok: false, error: "channels must be an array." };
		}
		if (record.channels.length > MAX_SUBSCRIPTION_CHANNELS) {
			return { ok: false, error: "Too many subscription channels." };
		}
		const channels: string[] = [];
		for (const channel of record.channels) {
			if (
				typeof channel !== "string" ||
				channel.length === 0 ||
				channel.length > MAX_CHANNEL_LENGTH ||
				!/^[a-zA-Z0-9._:-]+$/u.test(channel)
			) {
				return { ok: false, error: "Invalid subscription channel." };
			}
			channels.push(channel);
		}
		return { ok: true, type: record.type, channels };
	}

	private eventChannels(event: WebAppEvent): string[] {
		const channels: string[] = [event.type];
		if (event.sessionId) {
			channels.push(`session:${event.sessionId}`);
			if (event.type === "terminal.output") {
				channels.push(`terminal:${event.sessionId}`);
			}
		}
		return channels;
	}

	private sendToClient(client: WebSocket, raw: string): void {
		if (client.readyState !== WebSocket.OPEN) return;
		if (client.bufferedAmount > this.maxBufferedBytes) {
			this.dropClient(client);
			return;
		}

		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			this.sendTimeouts.delete(timeout);
			this.dropClient(client);
		}, this.sendTimeoutMs);
		timeout.unref?.();
		this.sendTimeouts.add(timeout);

		try {
			client.send(raw, (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.sendTimeouts.delete(timeout);
				if (error) this.dropClient(client);
			});
		} catch {
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				this.sendTimeouts.delete(timeout);
			}
			this.dropClient(client);
		}
	}

	private dropClient(client: WebSocket): void {
		this.clientFilters.delete(client);
		if (client.readyState === WebSocket.CLOSED) return;
		try {
			client.terminate();
		} catch {
			try {
				client.close();
			} catch {
				// Ignore close failures; this path is already isolating a bad client.
			}
		}
	}

	private payloadSessionId(payload: unknown): string | undefined {
		if (!payload || typeof payload !== "object" || !("sessionId" in payload)) {
			return undefined;
		}
		const sessionId = (payload as { sessionId?: unknown }).sessionId;
		return typeof sessionId === "string" && sessionId.trim()
			? sessionId
			: undefined;
	}

	listRecent(): WebAppEvent[] {
		return [...this.recent];
	}

	close(): Promise<void> {
		return new Promise((resolve) => {
			for (const timeout of this.sendTimeouts) clearTimeout(timeout);
			this.sendTimeouts.clear();
			for (const client of this.wss.clients) client.close();
			this.wss.close(() => resolve());
		});
	}
}
