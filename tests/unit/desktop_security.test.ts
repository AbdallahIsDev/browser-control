import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const security = require("../../desktop/security.cjs") as {
	createBrowserWindowOptions(preloadPath: string): {
		webPreferences: {
			contextIsolation: boolean;
			nodeIntegration: boolean;
			sandbox: boolean;
			webSecurity: boolean;
			allowRunningInsecureContent: boolean;
		};
	};
	isAllowedNavigation(targetUrl: string, appOrigin: string): boolean;
	isExternalHttpUrl(targetUrl: string, appOrigin: string): boolean;
};

test("desktop browser window disables dangerous renderer capabilities", () => {
	const options = security.createBrowserWindowOptions(
		path.join(process.cwd(), "desktop", "preload.cjs"),
	);

	assert.equal(options.webPreferences.contextIsolation, true);
	assert.equal(options.webPreferences.nodeIntegration, false);
	assert.equal(options.webPreferences.sandbox, true);
	assert.equal(options.webPreferences.webSecurity, true);
	assert.equal(options.webPreferences.allowRunningInsecureContent, false);
});

test("desktop navigation stays pinned to local app origin", () => {
	const origin = "http://127.0.0.1:7790";

	assert.equal(
		security.isAllowedNavigation("http://127.0.0.1:7790/tasks", origin),
		true,
	);
	assert.equal(
		security.isAllowedNavigation("http://localhost:7790/tasks", origin),
		false,
	);
	assert.equal(
		security.isAllowedNavigation("https://example.com", origin),
		false,
	);
	assert.equal(security.isExternalHttpUrl("https://example.com", origin), true);
});
