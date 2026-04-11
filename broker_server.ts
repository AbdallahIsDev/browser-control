import http from "node:http";

import { loadBrokerConfig } from "./broker_config";

const config = loadBrokerConfig();

const server = http.createServer((_request, response) => {
  response.writeHead(501, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Broker server not implemented yet" }));
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Broker server scaffold listening on http://127.0.0.1:${config.port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
