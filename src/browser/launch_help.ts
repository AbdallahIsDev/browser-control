export function formatLaunchBrowserCommand(
	port?: number,
	_platform: NodeJS.Platform = process.platform,
): string {
	return typeof port === "number"
		? `bc browser launch --port ${port}`
		: "bc browser launch";
}
