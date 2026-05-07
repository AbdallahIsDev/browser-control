"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
	createBrowserWindowOptions,
	isAllowedNavigation,
	isExternalHttpUrl,
} = require("./security.cjs");

const root = path.resolve(__dirname, "..");
const required = [
	"desktop/main.cjs",
	"desktop/preload.cjs",
	"desktop/security.cjs",
	"web/dist/index.html",
	"web/dist/app.js",
	"web/dist/styles.css",
];

for (const file of required) {
	assert.equal(
		fs.existsSync(path.join(root, file)),
		true,
		`${file} is required`,
	);
}

const options = createBrowserWindowOptions(path.join(__dirname, "preload.cjs"));
assert.equal(options.webPreferences.contextIsolation, true);
assert.equal(options.webPreferences.nodeIntegration, false);
assert.equal(options.webPreferences.sandbox, true);
assert.equal(options.webPreferences.webSecurity, true);

assert.equal(
	isAllowedNavigation("http://127.0.0.1:7790/tasks", "http://127.0.0.1:7790"),
	true,
);
assert.equal(
	isAllowedNavigation("https://example.com", "http://127.0.0.1:7790"),
	false,
);
assert.equal(
	isExternalHttpUrl("https://example.com", "http://127.0.0.1:7790"),
	true,
);

console.log(JSON.stringify({ success: true, checked: required.length + 6 }));
