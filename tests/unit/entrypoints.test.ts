import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "../..");

function readSource(relativePath: string): string {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("daemon and broker library modules are import-safe", () => {
	for (const file of [
		"src/daemon.ts",
		"src/broker_server.ts",
		"src/runtime/daemon.ts",
		"src/runtime/broker_server.ts",
	]) {
		assert.doesNotMatch(
			readSource(file),
			/require\.main\s*===\s*module/u,
			`${file} must not start background processes when imported`,
		);
	}
});

test("standalone daemon and broker bootstraps live in src/bin", () => {
	for (const file of ["src/bin/daemon.ts", "src/bin/broker_server.ts"]) {
		assert.match(readSource(file), /require\.main\s*===\s*module/u);
	}
});

test("package daemon and broker scripts target bin bootstraps", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
		scripts: Record<string, string>;
	};

	assert.equal(pkg.scripts["broker:start"], "ts-node src/bin/broker_server.ts");
	assert.equal(pkg.scripts.daemon, "ts-node src/bin/daemon.ts");
	assert.equal(pkg.scripts["daemon:dev"], "ts-node src/bin/daemon.ts --dev");
});
