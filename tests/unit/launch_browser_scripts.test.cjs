const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");

// ── Wrapper entry path tests ─────────────────────────────────────────

test("launch_browser.bat invokes the .cjs shim, not the raw .ts file", () => {
  const bat = fs.readFileSync(path.join(repoRoot, "launch_browser.bat"), "utf8");

  assert.match(bat, /launch_browser\.cjs/);
  assert.doesNotMatch(bat, /node.*launch_browser\.ts/);
  assert.match(bat, /node /);
});

test("launch_browser.ps1 invokes the .cjs shim, not the raw .ts file", () => {
  const ps1 = fs.readFileSync(path.join(repoRoot, "launch_browser.ps1"), "utf8");

  assert.match(ps1, /launch_browser\.cjs/);
  assert.doesNotMatch(ps1, /node.*launch_browser\.ts/);
});

test("scripts/launch_browser.sh invokes the .cjs shim, not the raw .ts file", () => {
  const sh = fs.readFileSync(path.join(repoRoot, "scripts", "launch_browser.sh"), "utf8");

  assert.match(sh, /launch_browser\.cjs/);
  assert.doesNotMatch(sh, /node.*launch_browser\.ts/);
  assert.match(sh, /node/);
});

// ── CJS shim existence and structure ──────────────────────────────────

test("scripts/launch_browser.cjs exists and bootstraps ts-node", () => {
  const shim = fs.readFileSync(path.join(repoRoot, "scripts", "launch_browser.cjs"), "utf8");

  assert.match(shim, /ts-node/);
  assert.match(shim, /require\(.*launch_browser/);
  assert.match(shim, /tsconfig\.json/);
});

// ── Behavioral tests of launcher helpers (loaded via ts-node) ────────

let launcher;
test("launcher module loads and exports expected helpers", () => {
  require("ts-node").register({ project: path.join(repoRoot, "tsconfig.json"), transpileOnly: true });
  launcher = require(path.join(repoRoot, "src", "runtime", "launch_browser.ts"));

  assert.equal(typeof launcher.resolveChromePath, "function");
  assert.equal(typeof launcher.isLikelyWsl, "function");
  assert.equal(typeof launcher.isPrivateIpv4, "function");
  assert.equal(typeof launcher.isWslAvailableFromWindows, "function");
  assert.equal(typeof launcher.getWslHostCandidates, "function");
  assert.equal(typeof launcher.getWslHostCandidatesFromWsl, "function");
  assert.equal(typeof launcher.getWslHostCandidatesFromWindows, "function");
  assert.equal(typeof launcher.waitForCdp, "function");
  assert.equal(typeof launcher.buildChromeArgs, "function");
  assert.equal(typeof launcher.writeDebugState, "function");
  assert.equal(typeof launcher.sanitizeManagedProfile, "function");
  assert.equal(typeof launcher._main, "function");
});

// ── isPrivateIpv4 ─────────────────────────────────────────────────────

test("isPrivateIpv4 accepts RFC1918 ranges", () => {
  assert.equal(launcher.isPrivateIpv4("10.0.0.1"), true);
  assert.equal(launcher.isPrivateIpv4("10.255.255.255"), true);
  assert.equal(launcher.isPrivateIpv4("172.16.0.1"), true);
  assert.equal(launcher.isPrivateIpv4("172.31.255.255"), true);
  assert.equal(launcher.isPrivateIpv4("192.168.0.1"), true);
  assert.equal(launcher.isPrivateIpv4("192.168.255.255"), true);
});

test("isPrivateIpv4 rejects public IPs", () => {
  assert.equal(launcher.isPrivateIpv4("8.8.8.8"), false);
  assert.equal(launcher.isPrivateIpv4("1.1.1.1"), false);
  assert.equal(launcher.isPrivateIpv4("172.15.0.1"), false);   // outside 172.16/12
  assert.equal(launcher.isPrivateIpv4("172.32.0.1"), false);   // outside 172.16/12
  assert.equal(launcher.isPrivateIpv4("192.169.0.1"), false);
  assert.equal(launcher.isPrivateIpv4("11.0.0.1"), false);
});

test("isPrivateIpv4 rejects loopback and malformed values", () => {
  assert.equal(launcher.isPrivateIpv4("127.0.0.1"), false);
  assert.equal(launcher.isPrivateIpv4("127.255.255.255"), false);
  assert.equal(launcher.isPrivateIpv4("0.0.0.0"), false);
  assert.equal(launcher.isPrivateIpv4("255.255.255.255"), false);
  assert.equal(launcher.isPrivateIpv4("not-an-ip"), false);
  assert.equal(launcher.isPrivateIpv4(""), false);
  assert.equal(launcher.isPrivateIpv4("999.999.999.999"), false);
});

// ── Platform detection ────────────────────────────────────────────────

test("isLikelyWsl returns false on non-Linux platforms", () => {
  const result = launcher.isLikelyWsl();
  if (!process.env.WSL_DISTRO_NAME && !process.env.WSL_INTEROP) {
    const release = require("node:os").release().toLowerCase();
    if (!release.includes("microsoft")) {
      assert.equal(result, false, "isLikelyWsl should be false without WSL markers");
    }
  }
});

test("isWslAvailableFromWindows returns false on non-Windows platforms", () => {
  if (process.platform !== "win32") {
    assert.equal(launcher.isWslAvailableFromWindows(), false);
  }
});

// ── WSL candidate discovery ───────────────────────────────────────────

test("getWslHostCandidates returns array on any platform", () => {
  const candidates = launcher.getWslHostCandidates();
  assert.ok(Array.isArray(candidates));
});

test("getWslHostCandidatesFromWindows returns empty on non-Windows", () => {
  if (process.platform !== "win32") {
    assert.deepEqual(launcher.getWslHostCandidatesFromWindows(), []);
  }
});

test("getWslHostCandidatesFromWsl returns only private IPs on Linux", () => {
  if (process.platform !== "linux") return; // skip on non-Linux
  const candidates = launcher.getWslHostCandidatesFromWsl();
  assert.ok(Array.isArray(candidates));
  for (const ip of candidates) {
    assert.ok(
      launcher.isPrivateIpv4(ip),
      `Expected private IP, got: ${ip}`,
    );
  }
});

test("getWslHostCandidates filters out public DNS from WSL-side sources", () => {
  // On a Linux/WSL box where resolv.conf has public nameservers like 8.8.8.8,
  // getWslHostCandidatesFromWsl should NOT return them.
  if (process.platform !== "linux") return;
  const candidates = launcher.getWslHostCandidatesFromWsl();
  for (const ip of candidates) {
    assert.notEqual(ip, "8.8.8.8", "Public DNS 8.8.8.8 must be filtered");
    assert.notEqual(ip, "1.1.1.1", "Public DNS 1.1.1.1 must be filtered");
  }
});

test("WSL CDP bridge is disabled by default and requires explicit opt-in", () => {
  assert.equal(launcher.isWslCdpBridgeEnabled({}), false);
  assert.equal(launcher.isWslCdpBridgeEnabled({ BROWSER_ENABLE_WSL_CDP_BRIDGE: "0" }), false);
  assert.equal(launcher.isWslCdpBridgeEnabled({ BROWSER_ENABLE_WSL_CDP_BRIDGE: "true" }), true);
  assert.equal(launcher.isWslCdpBridgeEnabled({ BROWSER_ENABLE_WSL_CDP_BRIDGE: "1" }), true);
});

// ── Profile Path Tests (Bug 2: Isolate Chrome profile) ─────────

test("resolveUserDataDir uses Browser Control data home, not Chrome default paths", () => {
  const os = require("node:os");
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-profile-test-"));
  const origHome = process.env.BROWSER_CONTROL_HOME;
  const origLocalAppData = process.env.LOCALAPPDATA;
  process.env.BROWSER_CONTROL_HOME = tmpHome;
  process.env.LOCALAPPDATA = path.join(os.tmpdir(), "fake-local-appdata");

  try {
    assert.equal(typeof launcher.getProfilesDir, "function");

    const profilesDir = launcher.getProfilesDir();
    assert.equal(profilesDir, path.join(tmpHome, "profiles"));

    const userDataDir = launcher.resolveUserDataDir("win32");
    assert.equal(userDataDir, path.join(tmpHome, "profiles", "BrowserControlProfile"));
    assert.ok(!userDataDir.includes(path.join("Google", "Chrome")));
    assert.ok(!userDataDir.startsWith(process.env.LOCALAPPDATA));
  } finally {
    if (origHome === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = origHome;
    }
    if (origLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = origLocalAppData;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ── buildChromeArgs ───────────────────────────────────────────────────

test("buildChromeArgs includes debugging port and user-data-dir", () => {
  const args = launcher.buildChromeArgs({
    port: 9222,
    userDataDir: "/tmp/test-profile",
    bindAddress: "0.0.0.0",
  });

  assert.ok(args.includes("--remote-debugging-port=9222"));
  assert.ok(args.includes("--user-data-dir=/tmp/test-profile"));
  assert.ok(args.includes("--remote-debugging-address=0.0.0.0"));
  assert.ok(args.includes("--no-first-run"));
});

test("buildChromeArgs disables extension contamination in managed automation profile", () => {
  const args = launcher.buildChromeArgs({
    port: 9222,
    userDataDir: "/tmp/test-profile",
    bindAddress: "127.0.0.1",
  });

  assert.ok(args.includes("--disable-extensions"));
  assert.ok(args.includes("--disable-component-extensions-with-background-pages"));
});

test("sanitizeManagedProfile removes Planet Search prefs and extension files", () => {
  const os = require("node:os");
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), "bc-sanitize-profile-"));
  const defaultDir = path.join(tmpProfile, "Default");
  const extDir = path.join(defaultDir, "Extensions", "kadaohckdkghfaclhjmkmplebcdcnfnp", "2.0.1_0");
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify({
    name: "Planet Search",
    chrome_settings_overrides: {
      search_provider: {
        name: "Planet Search",
        search_url: "https://planet-search.com/search/?q={searchTerms}",
      },
    },
  }));
  fs.writeFileSync(path.join(defaultDir, "Preferences"), JSON.stringify({
    default_search_provider_data: {
      mirrored_template_url_data: {
        short_name: "Planet Search",
        url: "https://planet-search.com/search/?q={searchTerms}",
      },
    },
    homepage: "https://planet-search.com/",
    extensions: {
      settings: {
        kadaohckdkghfaclhjmkmplebcdcnfnp: {
          manifest: { name: "Planet Search" },
        },
      },
    },
  }));

  try {
    launcher.sanitizeManagedProfile(tmpProfile);
    const prefs = JSON.parse(fs.readFileSync(path.join(defaultDir, "Preferences"), "utf8"));
    assert.equal(prefs.default_search_provider_data, undefined);
    assert.equal(prefs.homepage, undefined);
    assert.deepEqual(prefs.extensions.settings, {});
    assert.equal(fs.existsSync(path.join(defaultDir, "Extensions", "kadaohckdkghfaclhjmkmplebcdcnfnp")), false);
  } finally {
    fs.rmSync(tmpProfile, { recursive: true, force: true });
  }
});

test("buildChromeArgs omits --remote-debugging-address when bindAddress is empty", () => {
  const args = launcher.buildChromeArgs({
    port: 9222,
    userDataDir: "/tmp/test-profile",
    bindAddress: "",
  });

  const hasBindFlag = args.some(a => a.startsWith("--remote-debugging-address="));
  assert.equal(hasBindFlag, false);
});

// ── resolveChromePath ─────────────────────────────────────────────────

test("resolveChromePath throws for unknown platform with no Chrome installed", () => {
  assert.throws(
    () => launcher.resolveChromePath("aix", "/nonexistent/chrome"),
    /Chrome not found/,
  );
});

// ── writeDebugState ───────────────────────────────────────────────────

test("writeDebugState writes metadata to the data home .interop directory", () => {
  const os = require("node:os");
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-launcher-test-"));
  const origEnv = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = tmpHome;

  try {
    const state = launcher.writeDebugState({
      port: 9999,
      bindAddress: "0.0.0.0",
      wslHostCandidates: ["172.24.0.1"],
    });

    assert.equal(state.port, 9999);
    assert.equal(state.bindAddress, "0.0.0.0");
    assert.deepEqual(state.wslHostCandidates, ["172.24.0.1"]);
    assert.equal(state.wslPreferredUrl, "http://172.24.0.1:9999");
    assert.ok(state.updatedAt.length > 0);

    const metadataPath = path.join(tmpHome, ".interop", "chrome-debug.json");
    assert.ok(fs.existsSync(metadataPath), "chrome-debug.json should exist in data home");

    const saved = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    assert.equal(saved.port, 9999);
    assert.deepEqual(saved.wslHostCandidates, ["172.24.0.1"]);
  } finally {
    if (origEnv === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = origEnv;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("writeDebugState sets wslPreferredUrl to null when no private candidates", () => {
  const os = require("node:os");
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "bc-launcher-test-"));
  const origEnv = process.env.BROWSER_CONTROL_HOME;
  process.env.BROWSER_CONTROL_HOME = tmpHome;

  try {
    const state = launcher.writeDebugState({
      port: 9999,
      bindAddress: "0.0.0.0",
      wslHostCandidates: [],
    });

    assert.equal(state.wslPreferredUrl, null);
  } finally {
    if (origEnv === undefined) {
      delete process.env.BROWSER_CONTROL_HOME;
    } else {
      process.env.BROWSER_CONTROL_HOME = origEnv;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ── Launcher entry path smoke test ───────────────────────────────────

test("launcher shim rejects invalid port with validation error, not module error", async () => {
  const { execFile } = require("node:child_process");
  const shimPath = path.join(repoRoot, "scripts", "launch_browser.cjs");

  const result = await new Promise((resolve) => {
    execFile(process.execPath, [shimPath, "0"], { timeout: 10000 }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });

  const combined = (result.stdout || "") + (result.stderr || "");
  assert.ok(
    combined.includes("Invalid port") || combined.includes("Launch failed"),
    `Expected port validation error, got: ${combined}`,
  );
  assert.ok(
    !combined.includes("ERR_MODULE_NOT_FOUND"),
    "Should NOT fail with module resolution error",
  );
});
