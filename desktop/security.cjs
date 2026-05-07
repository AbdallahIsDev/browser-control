"use strict";

function createBrowserWindowOptions(preloadPath) {
	return {
		width: 1320,
		height: 860,
		minWidth: 960,
		minHeight: 640,
		show: false,
		backgroundColor: "#f5f6f8",
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
		},
	};
}

function isAllowedNavigation(targetUrl, appOrigin) {
	try {
		const parsed = new URL(targetUrl);
		return parsed.origin === appOrigin;
	} catch {
		return false;
	}
}

function isExternalHttpUrl(targetUrl, appOrigin) {
	try {
		const parsed = new URL(targetUrl);
		return /^https?:$/u.test(parsed.protocol) && parsed.origin !== appOrigin;
	} catch {
		return false;
	}
}

module.exports = {
	createBrowserWindowOptions,
	isAllowedNavigation,
	isExternalHttpUrl,
};
