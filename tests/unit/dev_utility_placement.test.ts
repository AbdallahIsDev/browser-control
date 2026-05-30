import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

test("raw CDP debug tab helper is kept out of the repo root", () => {
	const rootHelper = path.join(repoRoot, "open_debug_tab.cjs");
	const devHelper = path.join(repoRoot, "scripts", "dev", "open_debug_tab.cjs");

	assert.equal(fs.existsSync(rootHelper), false);
	assert.equal(fs.existsSync(devHelper), true);
	assert.match(
		fs.readFileSync(devHelper, "utf8"),
		/Development helper.*Use `bc browser cdp` for the production surface/s,
	);
});

