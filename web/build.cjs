const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const src = path.join(root, "src");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const name of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, name), path.join(dist, name));
}

console.log(`Built web app to ${dist}`);
