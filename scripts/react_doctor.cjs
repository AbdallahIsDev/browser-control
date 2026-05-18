#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const webSrc = path.join(repoRoot, "web", "src");

const checks = [];

function listFiles(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			listFiles(full, out);
		} else if (/\.(tsx|ts|css)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

function rel(file) {
	return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function lineNumberFor(source, index) {
	return source.slice(0, index).split(/\r?\n/u).length;
}

function addIssue(severity, file, message, line) {
	checks.push({ severity, file: rel(file), message, line });
}

function lineCount(source) {
	return source.split(/\r?\n/u).length;
}

function run() {
	if (!fs.existsSync(webSrc)) {
		console.error("React dashboard doctor: web/src not found.");
		process.exit(1);
	}

	const files = listFiles(webSrc);
	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		const relative = rel(file);

		if (/\bHealth\s+Unknown\b/i.test(source)) {
			addIssue("error", file, "Avoid raw 'Health Unknown' in dashboard UI.");
		}
		if (/Submit Intent|System Load|CDP Bridge/.test(source)) {
			addIssue("error", file, "Home surface contains stale developer-dashboard copy.");
		}
		const imgWithoutAlt = /<img\b(?![^>]*\balt=)/.exec(source);
		if (imgWithoutAlt) {
			addIssue(
				"error",
				file,
				"Image element missing alt text.",
				lineNumberFor(source, imgWithoutAlt.index),
			);
		}
		const buttonWithoutType = /<button\b(?![^>]*\btype=)/.exec(source);
		if (buttonWithoutType) {
			addIssue(
				"warn",
				file,
				"Button without explicit type may submit forms unexpectedly.",
				lineNumberFor(source, buttonWithoutType.index),
			);
		}
		const clickableNonButton = /<(?:div|span)\b[^>]*\bonClick=/.exec(source);
		if (clickableNonButton) {
			addIssue(
				"warn",
				file,
				"Clickable non-button element needs keyboard/a11y review.",
				lineNumberFor(source, clickableNonButton.index),
			);
		}
		if (/\brounded-none\b/.test(source)) {
			addIssue("warn", file, "Zero-radius UI found; verify against dashboard radius rules.");
		}
		if (/#[0-9a-f]{3,8}\b/i.test(source) && !relative.endsWith("index.css")) {
			addIssue("warn", file, "Hardcoded hex color outside token file.");
		}
		if (relative.endsWith(".tsx") && lineCount(source) > 650) {
			addIssue("warn", file, "Large React file; consider splitting if editing.");
		}
	}

	const errors = checks.filter((issue) => issue.severity === "error");
	const warnings = checks.filter((issue) => issue.severity === "warn");

	console.log("React dashboard doctor");
	console.log(`Scanned: ${files.length} files under web/src`);
	console.log(`Accessibility/product errors: ${errors.length}`);
	console.log(`Warnings: ${warnings.length}`);

	for (const issue of checks) {
		const location =
			typeof issue.line === "number" ? `${issue.file}:${issue.line}` : issue.file;
		console.log(`[${issue.severity}] ${location}: ${issue.message}`);
	}

	if (errors.length > 0) {
		process.exit(1);
	}
}

run();
