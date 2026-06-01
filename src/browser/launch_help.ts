export function getLaunchBrowserScriptName(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "launch_browser.bat" : "scripts/launch_browser.sh";
}

export function formatLaunchBrowserCommand(
	port?: number,
	_platform: NodeJS.Platform = process.platform,
): string {
	return typeof port === "number"
		? `bc browser launch --port ${port}`
		: "bc browser launch";
}
