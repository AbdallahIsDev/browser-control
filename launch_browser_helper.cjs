const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

function resolveChromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Chrome not found. Install Google Chrome first.");
}

function resolveUserDataDir(overridePath) {
  if (overridePath) {
    return overridePath;
  }
  return path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "CodexDebugProfile");
}

function buildChromeArgs({ port, userDataDir, initialUrl, bindAddress }) {
  const debugBindAddress = bindAddress || "127.0.0.1";
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
  ];

  if (debugBindAddress && String(debugBindAddress).trim()) {
    chromeArgs.push(`--remote-debugging-address=${String(debugBindAddress).trim()}`);
  }

  if (initialUrl && initialUrl.trim()) {
    chromeArgs.push(initialUrl);
  }

  return chromeArgs;
}

function spawnChrome(chromePath, chromeArgs) {
  return new Promise((resolve, reject) => {
    const chrome = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    chrome.once("error", reject);
    chrome.once("spawn", () => {
      chrome.unref();
      resolve();
    });
  });
}

async function main() {
  const port = Number(process.argv[2] || "9222");
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid remote debugging port: ${process.argv[2] ?? ""}`);
  }

  const userDataDir = resolveUserDataDir(process.argv[3]);
  const initialUrl = process.argv[4] !== undefined ? process.argv[4] : "about:blank";
  const chromePath = process.argv[5] || resolveChromePath();
  const bindAddress = process.argv[6];

  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeArgs = buildChromeArgs({ port, userDataDir, initialUrl, bindAddress });

  await spawnChrome(chromePath, chromeArgs);
}

module.exports = {
  buildChromeArgs,
  resolveChromePath,
  resolveUserDataDir,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
