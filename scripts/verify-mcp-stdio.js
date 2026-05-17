/**
 * verify-mcp-stdio.js
 * Verifies Browser Control MCP stdio server works correctly.
 * Tests: initialize, tools/list (bc_browser_launch with provider), bc_status
 *
 * Usage: node verify-mcp-stdio.js [path-to-cli.js]
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const CLI_PATH = process.argv[2] || path.resolve(__dirname, "..", "cli.js");
const NODE_EXE = process.execPath;

console.error("=== Browser Control MCP Stdio Verification ===");
console.error("");
console.error(`Config: ${NODE_EXE} "${CLI_PATH}" mcp serve`);
console.error("");

const child = spawn(NODE_EXE, [CLI_PATH, "mcp", "serve"], {
	stdio: ["pipe", "pipe", "pipe"],
	env: { ...process.env, BROWSER_CONTROL_STDIO_MODE: "mcp" },
});

let stdoutBuffer = "";
let passed = 0;
let failed = 0;

function log(msg) {
	console.error(msg);
}

// Accumulate stdout; never write to stdout ourselves (reserved for MCP protocol)
child.stdout.on("data", (d) => {
	stdoutBuffer += d.toString();
});

child.stderr.on("data", () => {
	// logs go to stderr, ignore for verification
});

function sendRequest(method, params, id) {
	const msg = JSON.stringify({
		jsonrpc: "2.0",
		id,
		method,
		params: params || {},
	});
	child.stdin.write(`${msg}\n`);
}

function sendNotification(method, params) {
	// JSON-RPC 2.0 notifications have no id field
	const msg = JSON.stringify({
		jsonrpc: "2.0",
		method,
		params: params || {},
	});
	child.stdin.write(`${msg}\n`);
}

/**
 * Wait for a JSON-RPC response with the given id.
 * Returns a promise that resolves with the parsed response object.
 * Does not leak listeners: uses a single persistent stdout handler.
 */
function waitForResponse(id, timeoutMs) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timeout for id=${id}`)),
			timeoutMs,
		);

		function check() {
			const lines = stdoutBuffer.split("\n").filter((l) => l.trim());
			for (const line of lines) {
				try {
					const parsed = JSON.parse(line);
					if (parsed.id === id) {
						clearTimeout(timer);
						child.stdout.off("data", check);
						resolve(parsed);
						return;
					}
				} catch {
					// not JSON yet, keep accumulating
				}
			}
		}

		child.stdout.on("data", check);
		// Check immediately in case response already arrived
		check();
	});
}

/**
 * Wait for the MCP server to be ready by checking that it has
 * written at least one line to stderr (its startup log).
 */
function waitForServerReady(timeoutMs = 10000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("MCP server did not start")),
			timeoutMs,
		);
		child.stderr.once("data", () => {
			clearTimeout(timer);
			resolve();
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

(async () => {
	try {
		// Wait for server to be ready before sending any requests
		await waitForServerReady(10000);
		// Give the server a moment to finish initialization
		await new Promise((r) => setTimeout(r, 500));

		// Step 1: Initialize (request with id)
		log("Step 1: Sending initialize...");
		sendRequest(
			"initialize",
			{
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "verify", version: "1.0.0" },
			},
			1,
		);
		const initResp = await waitForResponse(1, 10000);
		if (initResp.error) {
			log(`FAIL: initialize error: ${JSON.stringify(initResp.error)}`);
			failed++;
		} else {
			log("PASS: initialize OK");
			passed++;
		}

		// Step 2: Send initialized notification (NO id field)
		sendNotification("notifications/initialized", {});

		// Step 3: tools/list (request with id)
		log("Step 2: Sending tools/list...");
		sendRequest("tools/list", {}, 2);
		const listResp = await waitForResponse(2, 10000);
		if (listResp.error) {
			log(`FAIL: tools/list error: ${JSON.stringify(listResp.error)}`);
			failed++;
		} else {
			const tools = listResp.result.tools;
			const names = tools.map((t) => t.name);
			const launchTool = tools.find((t) => t.name === "bc_browser_launch");

			if (!names.includes("bc_status")) {
				log("FAIL: bc_status missing from tools");
				failed++;
			} else {
				log("PASS: bc_status in tools");
				passed++;
			}

			if (!launchTool) {
				log("FAIL: bc_browser_launch missing from tools");
				failed++;
			} else {
				log("PASS: bc_browser_launch in tools");
				passed++;
				if (
					!launchTool.inputSchema.properties ||
					!("provider" in launchTool.inputSchema.properties)
				) {
					log("FAIL: bc_browser_launch missing provider parameter");
					failed++;
				} else {
					log("PASS: bc_browser_launch has provider parameter");
					passed++;
				}
			}
		}

		// Step 4: bc_status (request with id)
		log("Step 3: Calling bc_status...");
		sendRequest("tools/call", { name: "bc_status", arguments: {} }, 3);
		const statusResp = await waitForResponse(3, 15000);
		if (statusResp.error) {
			log(`FAIL: bc_status error: ${JSON.stringify(statusResp.error)}`);
			failed++;
		} else {
			const result = statusResp.result;
			if (!result.content || !Array.isArray(result.content)) {
				log("FAIL: bc_status missing content");
				failed++;
			} else if (result.isError) {
				log("FAIL: bc_status returned isError=true");
				failed++;
			} else {
				const textContent = result.content.find((c) => c.type === "text");
				if (!textContent) {
					log("FAIL: bc_status missing text content");
					failed++;
				} else {
					const parsed = JSON.parse(textContent.text);
					if (!parsed.success) {
						log("FAIL: bc_status ActionResult not successful");
						failed++;
					} else if (!parsed.data?.daemon) {
						log("FAIL: bc_status missing daemon info");
						failed++;
					} else {
						log(
							`PASS: bc_status returned valid result (daemon: ${parsed.data.daemon.state})`,
						);
						passed++;
					}
				}
			}
		}

		// Step 5: Process alive check
		if (child.killed) {
			log("FAIL: process died");
			failed++;
		} else {
			log("PASS: process still alive");
			passed++;
		}

		log("");
		log(`=== Results: ${passed} passed, ${failed} failed ===`);

		child.kill("SIGTERM");
		setTimeout(() => process.exit(failed > 0 ? 1 : 0), 1000);
	} catch (err) {
		log(`FATAL: ${err.message}`);
		child.kill("SIGTERM");
		process.exit(1);
	}
})();
