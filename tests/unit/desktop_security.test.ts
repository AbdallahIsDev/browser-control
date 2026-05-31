import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const security = require("../../desktop/security.cjs") as {
	createBrowserWindowOptions(
		preloadPath: string,
		iconPath?: string,
	): {
		icon?: string;
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

const childEnv = require("../../safe_child_env.cjs") as {
	buildSafeChildEnv(
		source?: NodeJS.ProcessEnv,
		extra?: NodeJS.ProcessEnv,
	): NodeJS.ProcessEnv;
	isSafeChildEnvName(name: string): boolean;
};

test("safe child env keeps runtime allowlist and drops unrelated secrets", () => {
	const env = childEnv.buildSafeChildEnv(
		{
			AWS_SECRET_ACCESS_KEY: "aws-secret",
			BROWSER_CONTROL_HOME: "C:/bc",
			BROKER_API_KEY: "broker-key",
			GITHUB_TOKEN: "github-secret",
			NODE_OPTIONS: "--enable-source-maps",
			Path: "C:/Windows/System32",
			USERPROFILE: "C:/Users/test-user",
			npm_node_execpath: "C:/node.exe",
		},
		{ BROWSER_CONTROL_DESKTOP: "1" },
	);

	assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
	assert.equal(env.GITHUB_TOKEN, undefined);
	assert.equal(env.npm_node_execpath, undefined);
	assert.equal(env.BROWSER_CONTROL_HOME, "C:/bc");
	assert.equal(env.BROWSER_CONTROL_DESKTOP, "1");
	assert.equal(env.BROKER_API_KEY, "broker-key");
	assert.equal(env.NODE_OPTIONS, "--enable-source-maps");
	assert.equal(env.Path, "C:/Windows/System32");
	assert.equal(env.USERPROFILE, "C:/Users/test-user");
});

test("desktop app server spawn uses safe child env", () => {
	const mainPath = path.join(process.cwd(), "desktop", "main.cjs");
	const content = fs.readFileSync(mainPath, "utf8");

	assert.match(content, /buildSafeChildEnv\(process\.env,\s*\{/u);
	assert.doesNotMatch(content, /\.\.\.process\.env/u);
});

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

test("desktop browser window uses Browser Control icon when provided", () => {
	const iconPath = path.join(process.cwd(), "desktop", "icon.png");
	const options = security.createBrowserWindowOptions(
		path.join(process.cwd(), "desktop", "preload.cjs"),
		iconPath,
	);

	assert.equal(options.icon, iconPath);
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
