import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { redactObject } from "../observability/redaction";
import type { WebAppEvent, WebEventKind } from "./types";

const MAX_RECENT_EVENTS = 200;

interface ClientEventFilter {
	sessionId?: string;
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
	private nextId = 1;

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
				if (protocols.includes(token)) {
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
			client.once("close", () => this.clientFilters.delete(client));
			this.wss.emit("connection", client, request);
			client.send(
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
				client.send(raw);
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
		return !filter?.sessionId || event.sessionId === filter.sessionId;
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
			for (const client of this.wss.clients) client.close();
			this.wss.close(() => resolve());
		});
	}
}
