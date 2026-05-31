import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import test from "node:test";

import {
	closeRequestStreamAfterResponse,
	readJsonBody,
} from "../../src/web/security";

test("readJsonBody lets oversized requests return an error before closing the stream", async (t) => {
	let requestClosed = false;
	const server = http.createServer(async (request, response) => {
		request.once("close", () => {
			requestClosed = true;
		});
		try {
			await readJsonBody(request, 8);
			response.writeHead(200);
			response.end("ok");
		} catch (error) {
			closeRequestStreamAfterResponse(request, response, error);
			response.writeHead(400, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	});
	t.after(() => {
		server.close();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

	const address = server.address() as AddressInfo;
	const response = await new Promise<string>((resolve, reject) => {
		const socket = net.createConnection(address.port, "127.0.0.1");
		let rawResponse = "";
		socket.setEncoding("utf8");
		socket.on("connect", () => {
			socket.write(
				[
					"POST / HTTP/1.1",
					`Host: 127.0.0.1:${address.port}`,
					"Content-Type: application/json",
					"Content-Length: 64",
					"",
					'{"value":"oversized',
				].join("\r\n"),
			);
		});
		socket.on("data", (chunk) => {
			rawResponse += chunk;
		});
		socket.on("error", reject);
		socket.on("close", () => resolve(rawResponse));
	});

	assert.match(response, /^HTTP\/1\.1 400/u);
	assert.match(response, /Connection: close/iu);
	assert.match(response, /Request body too large/u);
	assert.equal(requestClosed, true);
});
