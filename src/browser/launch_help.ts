export function getLaunchBrowserScriptName(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? "launch_browser.bat" : "scripts/launch_browser.sh";
}

export function formatLaunchBrowserCommand(
	port?: number,
	platform: NodeJS.Platform = process.platform,
): string {
	const script = getLaunchBrowserScriptName(platform);
	return typeof port === "number" ? `${script} ${port}` : script;
}
