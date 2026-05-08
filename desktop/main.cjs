"use strict";

const { app, BrowserWindow, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");
const {
	createBrowserWindowOptions,
	isAllowedNavigation,
	isExternalHttpUrl,
} = require("./security.cjs");

let serverProcess = null;
let mainWindow = null;
let appOrigin = "";
let shuttingDown = false;

function rootDir() {
	return path.resolve(__dirname, "..");
}

function startAppServer() {
	return new Promise((resolve, reject) => {
		const cliPath = path.join(rootDir(), "cli.js");
		const nodeBin =
			process.env.BROWSER_CONTROL_NODE ||
			process.env.npm_node_execpath ||
			"node";
		const args = [
			cliPath,
			"web",
			"serve",
			"--json",
			"--port",
			"0",
			"--wait=true",
		];
		serverProcess = spawn(nodeBin, args, {
			cwd: rootDir(),
			env: {
				...process.env,
				BROWSER_CONTROL_DESKTOP: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		let settled = false;
		let rl = null;

		const cleanup = () => {
			if (rl) {
				rl.close();
				rl = null;
			}
		};

		const settleReject = (err) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err);
		};

		const settleResolve = (val) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(val);
		};

		const timeout = setTimeout(() => {
			settleReject(new Error("Timed out starting Browser Control app server."));
		}, 15000);
		timeout.unref?.();

		serverProcess.once("exit", (code) => {
			clearTimeout(timeout);
			settleReject(
				new Error(`Browser Control app server exited early with code ${code}.`),
			);
		});

		rl = readline.createInterface({ input: serverProcess.stdout });
		rl.on("line", (line) => {
			if (settled) return;
			try {
				const parsed = JSON.parse(line);
				if (parsed.success && parsed.url) {
					clearTimeout(timeout);
					appOrigin = parsed.url;
					settleResolve(parsed);
				}
			} catch {
				// Ignore non-JSON startup noise.
			}
		});

		serverProcess.stderr.on("data", (chunk) => {
			if (settled) return;
			const message = chunk.toString();
			if (/EADDRINUSE|Refusing to bind|Fatal error/i.test(message)) {
				clearTimeout(timeout);
				settleReject(new Error(message.trim()));
			}
		});
	});
}

function lockWindowNavigation(window, origin) {
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isExternalHttpUrl(url, origin)) {
			shell.openExternal(url);
		}
		return { action: "deny" };
	});

	window.webContents.on("will-navigate", (event, url) => {
		if (!isAllowedNavigation(url, origin)) {
			event.preventDefault();
			if (isExternalHttpUrl(url, origin)) shell.openExternal(url);
		}
	});
}

async function createWindow() {
	app.setName("Browser Control");
	Menu.setApplicationMenu(null);
	const server = await startAppServer();
	mainWindow = new BrowserWindow(
		createBrowserWindowOptions(path.join(__dirname, "preload.cjs")),
	);
	lockWindowNavigation(mainWindow, appOrigin);
	mainWindow.once("ready-to-show", () => mainWindow?.show());
	await mainWindow.loadURL(`${server.url}/#token=${server.token}`);
	if (!mainWindow.isVisible()) {
		mainWindow.show();
	}
	mainWindow.focus();
}

app
	.whenReady()
	.then(createWindow)
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		app.quit();
	});

app.on("window-all-closed", () => {
	app.quit();
});

function killServerProcessTree() {
	if (!serverProcess || serverProcess.killed) return;
	const pid = serverProcess.pid;
	if (process.platform === "win32" && pid) {
		spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		}).unref();
		return;
	}
	serverProcess.kill("SIGTERM");
}

app.on("before-quit", () => {
	shuttingDown = true;
	killServerProcessTree();
});

app.on("will-quit", () => {
	if (!shuttingDown) {
		killServerProcessTree();
	}
});
