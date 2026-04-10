const assert = require("node:assert/strict");
const test = require("node:test");

const { buildChromeArgs } = require("./launch_browser_helper.cjs");

test("buildChromeArgs exposes the debug port beyond Windows loopback", () => {
  const chromeArgs = buildChromeArgs({
    port: 9222,
    userDataDir: "C:\\Users\\11\\AppData\\Local\\Google\\Chrome\\CodexDebugProfile",
    initialUrl: "http://127.0.0.1:9222/json",
    bindAddress: "0.0.0.0",
  });

  assert.ok(chromeArgs.includes("--remote-debugging-port=9222"));
  assert.ok(chromeArgs.includes("--remote-debugging-address=0.0.0.0"));
});
