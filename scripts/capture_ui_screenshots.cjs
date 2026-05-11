"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const url = process.argv[2];

if (!url) {
	console.error("Usage: node scripts/capture_ui_screenshots.cjs <url>");
	process.exit(2);
}

const rootDir = path.resolve(__dirname, "..");
const reportDir = path.join(rootDir, "reports", "ui-verification");

const outputs = {
	desktop: path.join(reportDir, "sidebar-desktop.png"),
	mobile: path.join(reportDir, "sidebar-mobile.png"),
	refresh: path.join(reportDir, "sidebar-after-hard-refresh.png"),
	manifest: path.join(reportDir, "screenshot-manifest.json"),
};

const manifest = {
	url,
	startedAt: new Date().toISOString(),
	captures: [],
};

async function waitForApp(page) {
	await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
	await page.waitForSelector(".premium-app-container", { timeout: 15000 });
}

async function capture(page, filePath) {
	await page.screenshot({ path: filePath, fullPage: true });
	const stat = fs.statSync(filePath);
	if (!stat.isFile() || stat.size === 0) {
		throw new Error(`Screenshot missing or empty: ${filePath}`);
	}
	manifest.captures.push({
		file: path.relative(rootDir, filePath),
		bytes: stat.size,
		capturedAt: new Date().toISOString(),
		url: page.url(),
		title: await page.title(),
	});
}

async function assertNoHorizontalOverflow(page) {
	const metrics = await page.evaluate(() => ({
		innerWidth: window.innerWidth,
		bodyScrollWidth: document.body.scrollWidth,
		documentScrollWidth: document.documentElement.scrollWidth,
	}));
	const scrollWidth = Math.max(
		metrics.bodyScrollWidth,
		metrics.documentScrollWidth,
	);
	if (scrollWidth > metrics.innerWidth) {
		throw new Error(
			`Mobile horizontal overflow: scrollWidth=${scrollWidth}, innerWidth=${metrics.innerWidth}`,
		);
	}
	console.log(
		`Mobile overflow check: scrollWidth=${scrollWidth}, innerWidth=${metrics.innerWidth}`,
	);
}

(async () => {
	fs.mkdirSync(reportDir, { recursive: true });
	let browser;
	try {
		browser = await chromium.launch();

		const desktop = await browser.newPage({
			viewport: { width: 1440, height: 900 },
		});
		await waitForApp(desktop);
		await capture(desktop, outputs.desktop);
		await desktop.close();

		const mobile = await browser.newPage({
			viewport: { width: 375, height: 812 },
			isMobile: true,
		});
		await waitForApp(mobile);
		await assertNoHorizontalOverflow(mobile);
		await capture(mobile, outputs.mobile);
		await mobile.close();

		const refresh = await browser.newPage({
			viewport: { width: 1440, height: 900 },
		});
		await waitForApp(refresh);
		await refresh.reload({ waitUntil: "networkidle", timeout: 30000 });
		await refresh.waitForSelector(".premium-app-container", { timeout: 15000 });
		await capture(refresh, outputs.refresh);
		await refresh.close();

		manifest.finishedAt = new Date().toISOString();
		fs.writeFileSync(outputs.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

		for (const filePath of Object.values(outputs)) {
			const stat = fs.statSync(filePath);
			console.log(`${path.relative(rootDir, filePath)} ${stat.size} bytes`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.stack || error.message : error);
		process.exitCode = 1;
	} finally {
		if (browser) {
			await browser.close();
		}
	}
})();
