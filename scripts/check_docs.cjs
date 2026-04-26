#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const failures = [];
const sourceChecksSkipped = [];

function fail(message) {
  failures.push(message);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function toRel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function isInsideRoot(target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_[\]<>]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function collectAnchors(markdown) {
  const anchors = new Set();
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  for (const match of markdown.matchAll(headingRe)) {
    anchors.add(slugifyHeading(match[2]));
  }
  return anchors;
}

function normalizeSignature(value) {
  return value.replace(/\s+/g, " ").trim();
}

function commandKey(signature) {
  const parts = signature.split(/\s+/).filter(Boolean);
  if (["browser", "session", "daemon", "proxy", "memory", "skill", "report", "captcha", "policy", "knowledge", "term", "fs", "service", "debug", "tab", "config", "schedule"].includes(parts[0])) {
    return parts.slice(0, 2).join(" ");
  }
  return parts[0];
}

const requiredDocs = [
  "README.md",
  "docs/getting-started.md",
  "docs/cli.md",
  "docs/api.md",
  "docs/mcp.md",
  "docs/browser.md",
  "docs/terminal.md",
  "docs/security.md",
  "docs/troubleshooting.md",
  "docs/support-matrix.md",
  "docs/configuration.md",
  "docs/examples/README.md",
  "docs/examples/cli.md",
  "docs/examples/typescript-api.md",
  "docs/examples/mcp-config.md",
  "docs/examples/browser-workflow.md",
  "docs/examples/terminal-filesystem-workflow.md",
  "docs/examples/combined-workflow.md",
];

for (const file of requiredDocs) {
  if (!exists(file)) fail(`Missing required doc: ${file}`);
}

const publicMarkdown = [
  path.join(root, "README.md"),
  ...walk(path.join(root, "docs")).filter((file) => {
    const rel = toRel(file);
    return rel.endsWith(".md") && !rel.startsWith("docs/production-upgrade/");
  }),
];

const markdownCache = new Map(publicMarkdown.map((file) => [file, fs.readFileSync(file, "utf8")]));
const anchorCache = new Map([...markdownCache].map(([file, text]) => [file, collectAnchors(text)]));

for (const [file, text] of markdownCache) {
  const rel = toRel(file);

  if (/\b(TODO|TBD|FIXME)\b/i.test(text)) {
    fail(`Placeholder marker found in ${rel}`);
  }

  const linkRe = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkRe)) {
    const href = match[1].trim();
    if (!href) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;

    const hrefNoTitle = href.match(/^<([^>]+)>/)?.[1] ?? href.split(/\s+/)[0];
    const [rawTarget, rawAnchor] = hrefNoTitle.split("#");
    if (!rawTarget && rawAnchor) {
      if (!anchorCache.get(file)?.has(rawAnchor)) fail(`Broken anchor in ${rel}: ${href}`);
      continue;
    }

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(rawTarget);
    } catch (error) {
      fail(`Malformed link encoding in ${rel}: ${href}`);
      continue;
    }

    const target = path.resolve(path.dirname(file), decodedTarget);
    if (!isInsideRoot(target)) {
      fail(`Link escapes repo in ${rel}: ${href}`);
      continue;
    }
    if (!fs.existsSync(target)) {
      fail(`Broken link in ${rel}: ${href}`);
      continue;
    }
    if (rawAnchor && fs.statSync(target).isFile() && target.endsWith(".md")) {
      const targetText = fs.readFileSync(target, "utf8");
      if (!collectAnchors(targetText).has(rawAnchor)) fail(`Broken anchor in ${rel}: ${href}`);
    }
  }

  const jsonFenceRe = /```json\s*([\s\S]*?)```/g;
  for (const match of text.matchAll(jsonFenceRe)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      fail(`Invalid JSON fence in ${rel}: ${error.message}`);
    }
  }
}

const mcpDocs = read("docs/mcp.md");
let toolNames = [];
if (exists("mcp/tool_registry.ts")) {
  process.env.BROWSER_CONTROL_HOME = path.join(root, ".tmp-docs-check-home");
  require("ts-node/register");
  require("tsconfig-paths/register");
  const { getToolCategories } = require(path.join(root, "mcp", "tool_registry.ts"));
  const categories = getToolCategories({});
  toolNames = Object.values(categories).flat().sort();
  for (const name of toolNames) {
    if (!mcpDocs.includes(name)) fail(`MCP tool missing from docs/mcp.md: ${name}`);
  }
} else {
  sourceChecksSkipped.push("MCP registry check skipped because mcp/tool_registry.ts is not present.");
}

const cliDocs = read("docs/cli.md");
if (exists("cli.ts")) {
  const help = spawnSync(process.execPath, [
    "--require",
    "ts-node/register",
    "--require",
    "tsconfig-paths/register",
    "cli.ts",
    "--help",
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, BROWSER_CONTROL_HOME: path.join(root, ".tmp-docs-check-home") },
  });

  if (help.status !== 0) {
    fail(`CLI help failed: ${help.stderr || help.stdout}`);
  } else {
    const requiredCliSnippets = [
      "doctor [--json]",
      "setup [--json] [--non-interactive]",
      "--browser-mode",
      "--chrome-debug-port",
      "--chrome-bind-address",
      "--browserless-endpoint",
      "--browserless-api-key",
      "config list|get <key>|set <key> <value> [--json]",
      "open <url> [--wait-until]",
      "screenshot [--output]",
      "browser attach [--port] [--cdp-url] [--target-type",
      "browser provider add <name> --type browserless|custom --endpoint <url> [--api-key]",
      "schedule list",
      "daemon logs [--json]",
      "proxy test|add <url>|remove <url>|list",
      "memory stats|clear|get <key>|set <key> <value>",
      "skill list|health <name>|actions <name>|install <path>|validate <name-or-path>|remove <name>",
      "report generate|view",
      "term open [--shell] [--cwd] [--name]",
      "term read --session [--max-bytes]",
      "fs read <path> [--max-bytes]",
      "service register <name> --port <port> [--protocol",
      "[--detect] [--cwd]",
      "mcp serve",
    ];
    for (const snippet of requiredCliSnippets) {
      if (!cliDocs.includes(snippet)) fail(`docs/cli.md missing CLI snippet: ${snippet}`);
    }
  }
} else {
  sourceChecksSkipped.push("CLI drift check skipped because cli.ts is not present.");
}

if (failures.length) {
  console.error("Docs check failed:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

const sourceNote = sourceChecksSkipped.length ? ` (${sourceChecksSkipped.join(" ")})` : "";
console.log(`Docs check passed: ${publicMarkdown.length} markdown files, ${toolNames.length || "source-skipped"} MCP tools.${sourceNote}`);
