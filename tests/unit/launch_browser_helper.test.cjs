const assert = require("node:assert/strict");
const test = require("node:test");

const { buildChromeArgs } = require("../helpers/launch_browser_helper.cjs");

test("buildChromeArgs supports explicit non-loopback debug binds", () => {
  const chromeArgs = buildChromeArgs({
    port: 9222,
    userDataDir: "C:\\Users\\11\\AppData\\Local\\Google\\Chrome\\CodexDebugProfile",
    initialUrl: "http://127.0.0.1:9222/json",
    bindAddress: "0.0.0.0",
  });

  assert.ok(chromeArgs.includes("--remote-debugging-port=9222"));
  assert.ok(chromeArgs.includes("--remote-debugging-address=0.0.0.0"));
});

test("CLI helper defaults Chrome debug bind to loopback", () => {
  const chromeArgs = buildChromeArgs({
    port: 9222,
    userDataDir: "C:\\Users\\11\\AppData\\Local\\Google\\Chrome\\CodexDebugProfile",
    initialUrl: "http://127.0.0.1:9222/json",
  });

  assert.ok(chromeArgs.includes("--remote-debugging-port=9222"));
  assert.ok(chromeArgs.includes("--remote-debugging-address=127.0.0.1"));
});
