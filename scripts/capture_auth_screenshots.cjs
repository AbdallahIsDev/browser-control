#!/usr/bin/env node
/**
 * Auth verification screenshot capture.
 *
 * Usage:
 *   node scripts/capture_auth_screenshots.cjs [--token=<token>] [--port=<port>]
 *
 * The token must match the running server's BROWSER_CONTROL_WEB_TOKEN.
 * This script does NOT start the server — run the full app server first:
 *   npm run web:serve -- --port=7790 --token=<token>
 * or:
 *   node dist/index.js web open   (prints a tokenized URL automatically)
 *
 * If no --token is provided, only no-token screenshots are captured.
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const args = {};
for (const arg of process.argv.slice(2)) {
	const m = arg.match(/^--(\w+)=(.+)$/);
	if (m) args[m[1]] = m[2];
}

const PORT = args.port || process.env.BROWSER_CONTROL_WEB_PORT || "7790";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TOKEN = args.token || process.env.BROWSER_CONTROL_WEB_TOKEN || "";
const TOKEN_URL = TOKEN ? `${BASE_URL}/#token=${TOKEN}` : null;

const REPORT_DIR = path.resolve(__dirname, "..", "reports", "ui-verification");

const SHOTS = [];

function browserLaunchOptions(extra = {}) {
	const executablePath = process.env.BROWSER_CHROME_PATH;
	return executablePath
		? { ...extra, executablePath }
		: { ...extra, channel: process.env.BROWSER_CHANNEL || "chrome" };
}

// Always capture no-token screenshots
SHOTS.push(
	{ file: "locked-copy-command.png", url: BASE_URL, label: "home" },
	{ file: "locked-no-sidebar.png", url: BASE_URL, label: "home" },
);

// Capture token screenshots only if a token was provided
if (TOKEN_URL) {
	SHOTS.push(
		{ file: "auth-valid-token-sidebar.png", url: TOKEN_URL, label: "home" },
		{ file: "auth-after-forget.png", url: TOKEN_URL, label: "forget" },
		{ file: "browser-valid-token.png", url: TOKEN_URL, label: "browser" },
		{ file: "skills-valid-token.png", url: TOKEN_URL, label: "skills" },
	);
}

// Only capture invalid-token if explicitly provided as --invalid-token=<value>
const INVALID_TOKEN = args["invalid-token"];
if (INVALID_TOKEN) {
	SHOTS.push({
		file: "auth-invalid-token.png",
		url: `${BASE_URL}/#token=${INVALID_TOKEN}`,
		label: "home",
	});
}

const PAGE_LABELS = {
	home: "home",
	browser: "browser",
	skills: "skills",
};

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function navigate(page, targetLabel) {
	if (targetLabel === "home" || targetLabel === "forget") return;
	const label = PAGE_LABELS[targetLabel] || targetLabel;
	try {
		await page.evaluate((lbl) => {
			const labels = document.querySelectorAll(".nav-label");
			for (const el of labels) {
				if (el.textContent.toLowerCase() === lbl) {
					el.closest("button")?.click();
					return;
				}
			}
		}, label);
	} catch (e) {
		console.warn(`  Navigation to "${label}" had issue: ${e.message}`);
	}
	await sleep(2000);
}

(async () => {
	fs.mkdirSync(REPORT_DIR, { recursive: true });

	const manifest = {
		capturedAt: new Date().toISOString(),
		tokenProvided: !!TOKEN,
		captures: [],
	};

	let browser;
	try {
		browser = await chromium.launch(browserLaunchOptions({ headless: true }));
		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
		});

		for (const shot of SHOTS) {
			const page = await context.newPage();

			await page.goto(shot.url, {
				waitUntil: "networkidle",
				timeout: 30000,
			});

			// Wait for React to fully render
			await sleep(4000);

			// Handle "forget" scenario: clear sessionStorage and reload
			if (shot.label === "forget") {
				await page.evaluate(() => {
					sessionStorage.removeItem("bc-token");
				});
				await page.reload({ waitUntil: "networkidle", timeout: 30000 });
				await sleep(3000);
			}

			// Navigate to specific page if needed
			await navigate(page, shot.label);
			await sleep(2000);

			// Take screenshot
			const filePath = path.join(REPORT_DIR, shot.file);
			await page.screenshot({ path: filePath, fullPage: false });

			const stat = fs.statSync(filePath);
			manifest.captures.push({
				file: shot.file,
				url: page.url(),
				title: await page.title(),
				bytes: stat.size,
				capturedAt: new Date().toISOString(),
			});

			console.log(`✓ ${shot.file} (${stat.size} bytes) — ${page.url()}`);
			await page.close();
		}

		manifest.finishedAt = new Date().toISOString();
		const manifestPath = path.join(REPORT_DIR, "auth-verification-manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
		console.log(`\nManifest: ${manifestPath}`);
		console.log("Auth verification screenshots captured.");
	} catch (error) {
		console.error(
			"Fatal error:",
			error instanceof Error ? error.message : error,
		);
		process.exitCode = 1;
	} finally {
		if (browser) await browser.close();
	}
})();
