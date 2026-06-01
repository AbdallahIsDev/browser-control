"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadSafeChildEnv() {
	const sourcePath = path.join(__dirname, "src", "shared", "safe_child_env.ts");
	const distPath = path.join(__dirname, "dist", "shared", "safe_child_env.js");

	if (require.extensions[".ts"] && fs.existsSync(sourcePath)) {
		return require(sourcePath);
	}

	if (fs.existsSync(distPath)) {
		return require(distPath);
	}

	if (fs.existsSync(sourcePath)) {
		require("ts-node").register({
			project: path.join(__dirname, "tsconfig.json"),
			transpileOnly: true,
		});
		return require(sourcePath);
	}

	throw new Error("Unable to load Browser Control safe child environment module.");
}

module.exports = loadSafeChildEnv();
