"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const rawUrl = process.argv[2];

if (!rawUrl) {
	console.error("Usage: node scripts/capture_ui_screenshots.cjs <url>");
	process.exit(2);
}

// Extract token from URL hash (#token=...) or env var
let baseUrl = rawUrl;
let token = process.env.BROWSER_CONTROL_WEB_TOKEN || "";
const hashIdx = rawUrl.indexOf("#");
if (hashIdx !== -1) {
	const hash = rawUrl.slice(hashIdx + 1);
	const parts = hash.split("&");
	for (const part of parts) {
		if (part.startsWith("token=")) {
			token = part.slice("token=".length);
			break;
		}
	}
	baseUrl = rawUrl.slice(0, hashIdx);
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
	url: baseUrl,
	tokenProvided: !!token,
	startedAt: new Date().toISOString(),
	captures: [],
};

const EXTRA_PAGES = ["command", "packages", "workflows", "browser", "tasks", "evidence", "settings"];
const PAGE_LABELS = {
	command: "home",
	packages: "Package Library",
};

async function waitForApp(page) {
	await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
	if (token) {
		await page.evaluate((t) => {
			sessionStorage.setItem("bc-token", t);
		}, token);
		await page.reload({ waitUntil: "networkidle", timeout: 30000 });
	}
	await page.waitForSelector(".premium-app-container", { timeout: 15000 });
	await assertNotUnauthorized(page);
}

async function assertNotUnauthorized(page) {
	const bodyText = await page.evaluate(() => document.body?.textContent || "");
	if (bodyText.includes("Unauthorized")) {
		throw new Error("Page contains 'Unauthorized' — authentication failed");
	}
}

async function navigateTo(page, targetPage) {
	const targetLabel = PAGE_LABELS[targetPage] || targetPage;
	await page.evaluate(({ pageId, labelText }) => {
		const hamburger = document.querySelector('button[aria-label="Toggle navigation"]');
		if (hamburger && window.innerWidth <= 768) {
			hamburger.click();
		}
		const labels = document.querySelectorAll(".nav-label");
		for (const label of labels) {
			if (label.textContent.toLowerCase() === labelText) {
				label.closest("button")?.click();
				return;
			}
		}
		localStorage.setItem("bc-page", pageId);
		window.location.reload();
	}, { pageId: targetPage, labelText: targetLabel });
	await page.waitForTimeout(2000);
	await assertNotUnauthorized(page);
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

		// Extra page captures (desktop)
		for (const p of EXTRA_PAGES) {
			const extraPage = await browser.newPage({
				viewport: { width: 1440, height: 900 },
			});
			await waitForApp(extraPage);
			await navigateTo(extraPage, p);
			const filePath = path.join(reportDir, `${p}-desktop.png`);
			await capture(extraPage, filePath);
			await extraPage.close();
		}

		// Extra page captures (mobile)
		for (const p of EXTRA_PAGES) {
			const extraMobile = await browser.newPage({
				viewport: { width: 375, height: 812 },
				isMobile: true,
			});
			await waitForApp(extraMobile);
			await navigateTo(extraMobile, p);
			await assertNoHorizontalOverflow(extraMobile);
			const mFilePath = path.join(reportDir, `${p}-mobile.png`);
			await capture(extraMobile, mFilePath);
			await extraMobile.close();
		}

		manifest.finishedAt = new Date().toISOString();
		fs.writeFileSync(outputs.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

		for (const capture of manifest.captures) {
			console.log(`${capture.file} ${capture.bytes} bytes`);
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
