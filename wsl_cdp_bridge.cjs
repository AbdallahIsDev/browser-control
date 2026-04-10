const net = require("node:net");

function startTcpBridge({ listenHost, listenPort, targetHost, targetPort }) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((clientSocket) => {
      const upstreamSocket = net.connect({ host: targetHost, port: targetPort });

      clientSocket.pipe(upstreamSocket);
      upstreamSocket.pipe(clientSocket);

      const destroyBoth = () => {
        clientSocket.destroy();
        upstreamSocket.destroy();
      };

      clientSocket.on("error", destroyBoth);
      upstreamSocket.on("error", destroyBoth);
    });

    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function parseArgs(argv) {
  const options = {
    listenHost: "",
    listenPort: 0,
    targetHost: "127.0.0.1",
    targetPort: 0,
  };

  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    switch (key) {
      case "--listen-host":
        options.listenHost = value || "";
        break;
      case "--listen-port":
        options.listenPort = Number(value || "0");
        break;
      case "--target-host":
        options.targetHost = value || "127.0.0.1";
        break;
      case "--target-port":
        options.targetPort = Number(value || "0");
        break;
      default:
        break;
    }
  }

  if (!options.listenHost || !options.listenPort || !options.targetPort) {
    throw new Error(
      "Usage: node wsl_cdp_bridge.cjs --listen-host <host> --listen-port <port> --target-host <host> --target-port <port>",
    );
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const server = await startTcpBridge(options);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine bridge address.");
  }

  console.log(`WSL CDP bridge listening on ${address.address}:${address.port}`);
}

module.exports = {
  parseArgs,
  startTcpBridge,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
