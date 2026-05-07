import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { redactObject } from "../observability/redaction";
import type { WebAppEvent, WebEventKind } from "./types";

const MAX_RECENT_EVENTS = 200;

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
	private nextId = 1;

	handleUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		authorized: boolean,
		allowedOrigins: string[] = [],
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

		if (!authorized) {
			writeUpgradeError(socket, 401, "Unauthorized.");
			return;
		}
		this.wss.handleUpgrade(request, socket, head, (client) => {
			this.wss.emit("connection", client, request);
			client.send(
				JSON.stringify({
					type: "runtime.status",
					replay: true,
					events: this.recent,
				}),
			);
		});
	}

	emit<T>(
		type: WebEventKind,
		payload: T,
		options: { sessionId?: string; actionId?: string } = {},
	): WebAppEvent {
		const event: WebAppEvent = {
			id: `evt-${this.nextId++}`,
			type,
			timestamp: new Date().toISOString(),
			...(options.sessionId ? { sessionId: options.sessionId } : {}),
			...(options.actionId ? { actionId: options.actionId } : {}),
			payload: redactObject(payload),
		};
		this.recent.push(event);
		while (this.recent.length > MAX_RECENT_EVENTS) this.recent.shift();

		const raw = JSON.stringify(event);
		for (const client of this.wss.clients) {
			if (client.readyState === WebSocket.OPEN) client.send(raw);
		}
		return event;
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
