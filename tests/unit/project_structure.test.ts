import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT_TS_ENTRYPOINTS = new Set(["broker_server.ts", "cli.ts", "daemon.ts", "main.ts"]);

test("repo root does not contain TypeScript compatibility shims", () => {
  const root = process.cwd();
  const shimFiles = fs.readdirSync(root)
    .filter((name) => name.endsWith(".ts") && !ROOT_TS_ENTRYPOINTS.has(name))
    .filter((name) => {
      const content = fs.readFileSync(path.join(root, name), "utf8").trim();
      return /^export \* from "\.\/src\/[^"]+";$/.test(content);
    });

  assert.deepEqual(shimFiles, []);
});

test("live proxy config is ignored and example warns about credentials", () => {
  const root = process.cwd();
  const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  const proxyExample = fs.readFileSync(path.join(root, "proxies.example.json"), "utf8");

  assert.match(gitignore, /^proxies\.json$/m);
  assert.match(proxyExample, /Do not commit proxies\.json/);
  assert.match(proxyExample, /credential vault/);
});
