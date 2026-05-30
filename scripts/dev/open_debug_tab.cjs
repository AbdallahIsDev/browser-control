// Development helper: opens a CDP debug tab against a local Chrome instance.
// Use `bc browser cdp` for the production surface.

const http = require("node:http");
const WebSocketImpl = globalThis.WebSocket || require("ws");

const port = Number(process.argv[2] || "9222");
const targetUrl = process.argv[3];

if (!targetUrl) {
  console.error("Usage: node scripts/dev/open_debug_tab.cjs <port> <url>");
  process.exit(1);
}

function httpPut(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "PUT", timeout: 10000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid JSON: ${data}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function cdpNavigate(wsUrl, url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("CDP timeout"));
    }, 10000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } }));
    });
    ws.on("message", (msg) => {
      const data = JSON.parse(msg.toString());
      if (data.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  const tab = await httpPut("/json/new");
  console.log(`Created tab ${tab.id}`);

  await cdpNavigate(tab.webSocketDebuggerUrl, targetUrl);
  console.log(`Navigated to ${targetUrl}`);
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
