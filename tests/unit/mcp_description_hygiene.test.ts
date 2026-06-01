import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "../..");

test("MCP source descriptions do not leak internal section references", () => {
	const files = [
		"src/mcp/types.ts",
		"src/mcp/server.ts",
		"src/mcp/tools/browser.ts",
		"src/mcp/tools/debug.ts",
		"src/mcp/tools/workflow.ts",
	];

	for (const file of files) {
		const source = fs.readFileSync(path.join(root, file), "utf8");
		assert.doesNotMatch(source, /Section \d+|section-\d+|production-upgrade/u, file);
	}
});
