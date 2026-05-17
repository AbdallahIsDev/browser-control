"use strict";

const fs = require("node:fs");
const path = require("node:path");
const rcedit = require("rcedit");

module.exports = async function desktopAfterPack(context) {
	if (context.electronPlatformName !== "win32") return;

	const rootDir = context.packager.projectDir;
	const iconPath = path.join(rootDir, "desktop", "icon.ico");
	const exePath = path.join(context.appOutDir, "Browser Control.exe");

	if (!fs.existsSync(iconPath)) {
		throw new Error(`Desktop icon is missing: ${iconPath}`);
	}
	if (!fs.existsSync(exePath)) {
		throw new Error(`Packaged executable is missing: ${exePath}`);
	}

	await rcedit(exePath, {
		icon: iconPath,
		"version-string": {
			FileDescription: "Browser Control",
			ProductName: "Browser Control",
		},
	});
};
