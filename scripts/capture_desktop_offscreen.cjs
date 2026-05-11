"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const rootDir = path.resolve(__dirname, "..");
const output =
	process.argv[2] ||
	path.join(rootDir, "reports", "ui-verification", "desktop-sidebar.png");

(async () => {
	let app;
	try {
		fs.mkdirSync(path.dirname(output), { recursive: true });
		app = await electron.launch({
			args: [path.join(rootDir, "desktop", "main.cjs")],
			cwd: rootDir,
			env: {
				...process.env,
				BROWSER_CONTROL_DESKTOP: "1",
			},
		});

		const page = await app.firstWindow({ timeout: 30000 });
		await page.waitForSelector(".premium-app-container", { timeout: 30000 });
		await page.screenshot({ path: output, fullPage: true });

		const stat = fs.statSync(output);
		if (!stat.isFile() || stat.size === 0) {
			throw new Error(`Desktop screenshot missing or empty: ${output}`);
		}

		const title = await page.title();
		console.log(`Desktop window title: ${title || "(untitled)"}`);
		console.log(
			`${path.relative(rootDir, output)} ${stat.size} bytes`,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.stack || error.message : error);
		process.exitCode = 1;
	} finally {
		if (app) {
			await app.close();
		}
	}
})();
