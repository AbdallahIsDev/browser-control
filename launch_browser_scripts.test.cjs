const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("launch_browser.ps1 repairs stale loopback-only sessions before reuse", () => {
  const script = fs.readFileSync(path.join(__dirname, "launch_browser.ps1"), "utf8");

  assert.match(script, /function Test-DebugChromeBinding/);
  assert.match(script, /Existing Chrome debug session is only bound to loopback/);
});

test("launch_browser.bat exposes bind address override for future launches", () => {
  const script = fs.readFileSync(path.join(__dirname, "launch_browser.bat"), "utf8");

  assert.match(script, /set BIND_ADDRESS=0\.0\.0\.0/i);
  assert.match(script, /-BindAddress %BIND_ADDRESS%/i);
});

test("launch_browser.ps1 validates WSL reachability instead of trusting metadata alone", () => {
  const script = fs.readFileSync(path.join(__dirname, "launch_browser.ps1"), "utf8");

  assert.match(script, /function Test-WslDebugEndpointValid/);
  assert.match(script, /wsl\.exe/);
  assert.match(script, /WSL debug endpoint/i);
});

test("launch_browser.ps1 starts the WSL CDP bridge when Chrome remains loopback-only", () => {
  const script = fs.readFileSync(path.join(__dirname, "launch_browser.ps1"), "utf8");

  assert.match(script, /wsl_cdp_bridge\.cjs/);
  assert.match(script, /function Start-WslCdpBridge/);
  assert.match(script, /function Stop-WslCdpBridge/);
});
