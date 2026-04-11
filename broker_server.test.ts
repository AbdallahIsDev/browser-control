import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("broker_server loads .env from cwd and starts the stub server", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "broker-server-test-"));
  const envPath = path.join(tempDir, ".env");
  const tsNodeRegister = path.join(
    __dirname,
    "node_modules",
    "ts-node",
    "register",
  );
  const brokerServerPath = path.join(__dirname, "broker_server.ts");

  fs.writeFileSync(
    envPath,
    [
      "BROKER_SECRET=test-secret",
      "BROKER_ALLOWED_DOMAINS=CHAT.OpenAI.COM",
      "BROKER_PORT=7799",
    ].join("\n"),
  );

  const child = spawn(
    process.execPath,
    [
      "--require",
      tsNodeRegister,
      "-e",
      `process.chdir(${JSON.stringify(tempDir)}); require(${JSON.stringify(
        brokerServerPath,
      )});`,
    ],
    {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for broker startup.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10000);

      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.stdout.on("data", () => {
        if (stdout.includes("Broker server scaffold listening on http://127.0.0.1:7799")) {
          clearTimeout(timeout);
          resolve();
        }
      });

      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Broker server exited before startup completed (code=${code}, signal=${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      });
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timed out waiting for broker server process to exit."));
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
});
