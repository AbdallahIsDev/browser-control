const http = require("node:http");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Browser Control Golden Local App</title>
  </head>
  <body>
    <main>
      <h1>Golden Local Workflow</h1>
      <form id="golden-form">
        <label for="golden-input">Workflow input</label>
        <input id="golden-input" name="golden-input" value="" autocomplete="off">
        <button id="golden-submit" type="submit">Save workflow</button>
      </form>
      <p id="golden-status" role="status" aria-live="polite">Waiting</p>
    </main>
    <script>
      document.getElementById("golden-form").addEventListener("submit", (event) => {
        event.preventDefault();
        const value = document.getElementById("golden-input").value;
        document.getElementById("golden-status").textContent = "Saved: " + value;
      });
    </script>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, fixture: "golden-local-app" }));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(Number(process.env.PORT || 0), "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${port}/`, port }) + "\n");
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
