import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";

import { resolveManagedLaunchPort } from "../../src/browser_connection";

async function withOccupiedPort<T>(
	callback: (port: number) => Promise<T>,
): Promise<T> {
	const server = net.createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert.equal(typeof address, "object");
	const port = (address as net.AddressInfo).port;
	try {
		return await callback(port);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

describe("resolveManagedLaunchPort", () => {
	it("keeps an available configured port when no explicit port is requested", async () => {
		const port = await resolveManagedLaunchPort(
			{ configuredPort: 19222 },
			async () => false,
		);

		assert.equal(port, 19222);
	});

	it("chooses a fallback port when the configured managed port is occupied", async () => {
		await withOccupiedPort(async (occupiedPort) => {
			const port = await resolveManagedLaunchPort(
				{ configuredPort: occupiedPort },
				async () => false,
			);

			assert.notEqual(port, occupiedPort);
			assert.ok(port > 0);
		});
	});

	it("rejects when an explicit managed port is occupied", async () => {
		await withOccupiedPort(async (occupiedPort) => {
			await assert.rejects(
				() =>
					resolveManagedLaunchPort(
						{
							requestedPort: occupiedPort,
							configuredPort: 19222,
						},
						async () => false,
					),
				/Port .* is already in use/,
			);
		});
	});
});
