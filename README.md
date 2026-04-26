# Browser Control
## Global Reusable Framework — Codex + Playwright + CDP

This folder is the **global** browser automation foundation.
Never duplicate the core files — import them.

---

## Install And First Run

Requires Node.js `>=22`.

Clean checkout:

```bash
npm ci
npm run build
node cli.js --help
node cli.js setup --non-interactive
node cli.js doctor
node cli.js status --json
```

Windows PowerShell with isolated data home:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:TEMP ("browser-control-" + [guid]::NewGuid().ToString())
node cli.js setup --non-interactive --json
node cli.js doctor --json
node cli.js status --json
```

Windows `cmd.exe`:

```cmd
set BROWSER_CONTROL_HOME=%TEMP%\browser-control-%RANDOM%
node cli.js setup --non-interactive --json
node cli.js doctor --json
```

Linux/macOS:

```bash
BC_HOME="$(mktemp -d)"
BROWSER_CONTROL_HOME="$BC_HOME" node cli.js setup --non-interactive --json
BROWSER_CONTROL_HOME="$BC_HOME" node cli.js doctor --json
```

Packed install smoke:

```bash
npm pack
mkdir bc-smoke && cd bc-smoke
npm init -y
npm install ../browser-control-1.0.0.tgz
npx bc --help
npx bc setup --non-interactive
npx bc doctor
```

Global install from a local tarball also works:

```bash
npm install -g ../browser-control-1.0.0.tgz
bc --help
```

Chrome is optional for terminal and filesystem workflows. If Chrome or CDP is missing, `bc doctor` reports degraded browser capability and still allows terminal/filesystem-only use. Install Chrome or set `BROWSER_CHROME_PATH` only when browser automation is needed.

MCP:

```bash
bc setup --non-interactive
bc mcp serve
```

MCP client config:

```json
{
  "mcpServers": {
    "browser-control": {
      "command": "bc",
      "args": ["mcp", "serve"]
    }
  }
}
```

---

## Folder Structure

```
browser-control/
│
├── launch_browser.ps1       ← Chrome launcher wrapper (Windows)
├── launch_browser.bat       ← Chrome launcher wrapper (Windows)
├── scripts/
│   ├── launch_browser.ts    ← Cross-platform Chrome launcher (main entry)
│   ├── launch_browser.cjs   ← Node shim (bootstraps ts-node)
│   └── launch_browser.sh    ← Chrome launcher wrapper (Linux/macOS)
├── browser_core.ts          ← Public compatibility import; implementation lives in browser/core.ts
├── selector_store.ts        ← Global: the selector caching pattern (reference)
│
└── project-template/        ← COPY THIS for every new project
    ├── _README.ts
    ├── setup.json           ← Project config: port and target site info
    ├── selectors.ts         ← Site-specific discovery + SelectorMap
    ├── selectors.json       ← Auto-generated cache (commit this file)
    └── main.ts              ← Your automation script
```

Runtime data lives in `~/.browser-control/` (override with `BROWSER_CONTROL_HOME`):
```
~/.browser-control/
├── memory.sqlite            ← Persistent key-value store
├── reports/                 ← Telemetry reports
├── logs/                    ← Log files
├── .interop/                ← Chrome debug metadata, daemon PID
└── skills/                  ← Installed skills
```

Contributor source ownership is documented in `docs/architecture/source-layout.md`. New internal browser edits should target `browser/` modules; root `browser_core.ts` remains for public/backward-compatible imports.

---

## Quick Start — New Project

```bash
# 1. Copy the template
cp -r project-template/ my-new-project/
cd my-new-project/

# 2. Edit setup.json with your target URL and port
#    Edit selectors.ts with your site's elements

# 3. Start the browser debug session on the shared automation profile
launch_browser.bat 9222

# 4. Run selector discovery (one-time, saves selectors.json)
npx ts-node selectors.ts

# 5. Write your automation in main.ts, then run it
npx ts-node main.ts
```

---

## Windows + WSL Interop

`launch_browser.bat` now defaults to `0.0.0.0` for the Chrome debug bind address so the same
Windows Chrome session can be attached from Windows and WSL.

Each launch writes `~/.browser-control/.interop/chrome-debug.json` with the preferred CDP endpoint candidates.
`browser_core.ts` reads that metadata automatically, so Hermes in WSL does
not need a manual port proxy or a hardcoded host IP anymore.

If you ever need to override discovery manually:

- `BROWSER_DEBUG_URL=http://host:port`
- `BROWSER_DEBUG_HOST=host`

You can still override the bind address explicitly:

```bat
launch_browser.bat 9222 0.0.0.0
```

The launcher validates local CDP access and, when WSL is installed, it also probes the endpoint
from WSL before reporting success.

---

## Speed Principles

| What | Why it's fast |
|---|---|
| `smartClick(page, sel)` | Uses Playwright actionability checks with a compact retry path |
| `smartFill(page, sel, val)` | Uses locator focus/fill and only commits with `commit: true` |
| `loadSelectors()` | Reads from JSON on first use — no network, no DOM |
| `discoverSelectors()` | Runs ONCE, then skips forever (`selectorsDiscovered: true`) |
| `screenshotElement()` | Crops to element only — not `fullPage:true` |
| `waitForElement()` | Condition-based — never fixed `waitForTimeout()` |
| `waitForAny()` | `Promise.any()` across multiple selectors — only succeeds on the first visible match |
| URL-based tab detection | `page.url().includes(pattern)` — instant, never fails |

---

## The Selector Priority Order

Inside `page.evaluate()`, every element is converted to a selector using this priority:

```
data-test     → [data-test="value"]         ← most stable (test attributes rarely change)
data-testid   → [data-testid="value"]        ← stable
aria-label    → [aria-label="value"]         ← stable for accessibility-first sites
id            → #id                          ← stable if ID is semantic
className     → tag.class1.class2            ← fragile — React rebuilds these often
```

React apps like Exness use `data-test` attributes heavily — these are the best selectors
because they are explicitly added for testing and do not change when the UI is rebuilt.

---

## Adding a New Project — Checklist

- [ ] Copy `project-template/` to `my-project/`
- [ ] Edit `setup.json`: set `target_url`, `url_pattern`, `project`
- [ ] Edit `selectors.ts`: update `SelectorMap` interface and discovery logic
- [ ] Run `launch_browser.bat` to start the shared automation profile on the debug port
- [ ] Open the target site in the debug Chrome window
- [ ] Run `npx ts-node selectors.ts` to populate `selectors.json`
- [ ] Verify `selectors.json` has `"selectorsDiscovered": true`
- [ ] Write automation in `main.ts` using `browser_core.ts` + `selectors`
- [ ] Test with `npx ts-node main.ts`

---

## Windows + WSL

`launch_browser.bat` now does two things on Windows:

- launches the shared Chrome automation profile on the CDP port
- publishes that same CDP session to WSL through a local bridge on the WSL gateway IP

That means the same visible Windows Chrome session is reachable from both environments:

- Windows tools use `http://127.0.0.1:<port>`
- WSL tools prefer the bridge URL written to `~/.browser-control/.interop/chrome-debug.json`

If the launcher finds an existing Chrome debug session that is only bound to loopback, it repairs WSL access by starting the bridge instead of opening a second browser.

## Data Directory

Runtime data (memory, reports, logs, Chrome debug metadata) is stored in:

```
~/.browser-control/
```

Override with the `BROWSER_CONTROL_HOME` environment variable.

All automation projects should share the same persistent automation profile so
logins persist between runs. `launch_browser.bat` enables the debug port on the
shared profile and writes connection metadata to `~/.browser-control/.interop/chrome-debug.json`;
it does not create a different profile for each project.

Chrome 136+ no longer allows `--remote-debugging-port` on the default Chrome
data directory, so the launcher intentionally uses one dedicated shared profile
for automation instead of your everyday Chrome profile.

Import `browser_core.ts` using a relative path from your project:
```typescript
import { connectBrowser, smartClick } from "../../browser-control/browser_core";
```

Or add a `tsconfig.json` path alias pointing to this repo:
```json
{
  "compilerOptions": {
    "paths": {
      "@bc/*": ["./path/to/browser-control/*"]
    }
  }
}
```

Then import as:
```typescript
import { connectBrowser, smartClick } from "@bc/browser_core";
```

Load environment variables before connecting Stagehand:
```typescript
import "dotenv/config";
```

Required Stagehand env vars:
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (optional override)
- `OPENROUTER_BASE_URL` (optional override)

## Stealth Mode

The core now supports an opt-in stealth context for new automation-owned browser contexts.

This does **not** mutate already-open shared tabs in the persistent Chrome session. Instead, it creates a fresh context and applies Playwright-native init-script evasions before the page runs.

Use it when you need stealth hardening without breaking the default shared-CDP workflow:

```typescript
import { connectBrowser, createAutomationContext } from "@bc/browser_core";

const browser = await connectBrowser(9222);
const context = await createAutomationContext(browser, {
  enableStealth: true,
  locale: "en-US",
  timezoneId: "America/New_York",
});

const page = await context.newPage();
```

You can also enable the stealth path through environment variables:

- `ENABLE_STEALTH=true`
- `STEALTH_LOCALE=en-US`
- `STEALTH_TIMEZONE_ID=America/New_York`
- `BROWSER_USER_AGENT=...`
- `STEALTH_FINGERPRINT_SEED=...`
- `STEALTH_WEBGL_VENDOR=...`
- `STEALTH_WEBGL_RENDERER=...`
- `STEALTH_PLATFORM=Win32`
- `STEALTH_HARDWARE_CONCURRENCY=8`
- `STEALTH_DEVICE_MEMORY=8`

Stealth coverage currently includes:

- `navigator.webdriver` masking
- `window.chrome.runtime` presence spoofing
- deterministic `HTMLCanvasElement.toDataURL()` variation per context
- WebGL vendor and renderer spoofing
- locale and timezone consistency for the automation-owned context

Default behavior is unchanged when stealth is not enabled.

## Proxy Rotation

The core now includes `proxy_manager.ts` for loading, rotating, cooling down, and validating proxies.

Proxy support is designed for automation-owned contexts created through `createAutomationContext()`. It does not retroactively change the network path of already-open tabs in the shared persistent Chrome session.

### Proxy Sources

You can load proxies from either source, or both together:

1. `proxies.json` in the project root
2. `PROXY_LIST` as a comma-separated list

Example `proxies.json`:

```json
[
  "http://127.0.0.1:8001",
  {
    "url": "http://proxy.example.com:8080",
    "username": "proxy-user",
    "password": "proxy-pass",
    "status": "active"
  }
]
```

Example `PROXY_LIST`:

```bash
PROXY_LIST=http://127.0.0.1:8001,http://127.0.0.1:8002
```

### Using A Proxy

```typescript
import { connectBrowser, createAutomationContext } from "@bc/browser_core";
import { ProxyManager, loadProxyConfigs } from "@bc/proxy_manager";

const browser = await connectBrowser(9222);
const manager = new ProxyManager(loadProxyConfigs());
const proxy = manager.getProxy();

const context = await createAutomationContext(browser, {
  proxy: proxy ?? undefined,
});
```

### Testing Proxies

Validate every configured proxy with:

```bash
npx ts-node proxy_manager.ts test
```

The validation helper uses Playwright's request context through the configured proxy and reports pass/fail per proxy.

### Notes

- proxies rotate in round-robin order across active entries
- failed proxies enter cooldown before they are retried
- repeated failures can mark a proxy as dead
- proxy credentials are stripped out of the Playwright `server` field and passed separately as `username` and `password`

## CAPTCHA Solving

The core now includes `captcha_solver.ts` with a pluggable provider strategy.

Supported providers:

- `2captcha`
- `anticaptcha`
- `capsolver`

Environment variables:

- `CAPTCHA_PROVIDER`
- `CAPTCHA_API_KEY`
- `CAPTCHA_TIMEOUT_MS`

### Basic Usage

```typescript
import { CaptchaSolver } from "@bc/captcha_solver";

const solver = new CaptchaSolver();
const token = await solver.solveReCaptcha("site-key", "https://example.com/login");
```

### Auto-Solve During Actions

`smartClick()` and `smartFill()` can now auto-detect and solve a CAPTCHA when you opt in:

```typescript
import { smartClick } from "@bc/browser_core";
import { CaptchaSolver } from "@bc/captcha_solver";

const solver = new CaptchaSolver();

await smartClick(page, "#submit", {
  autoSolveCaptcha: true,
  captchaSolver: solver,
  captchaTimeoutMs: 15000,
});
```

If the action fails because a CAPTCHA challenge is present, the helper will attempt to solve it and retry once.

### Detection Coverage

`waitForCaptcha()` can detect and inject tokens for:

- reCAPTCHA
- hCaptcha
- Cloudflare Turnstile

Provider caveat:

- hCaptcha is verified in the current 2Captcha adapter
- Anti-Captcha and CapSolver are wired for the shared provider strategy, but may throw for hCaptcha if the selected provider does not advertise support in its public task catalog

## Task Engine

`task_engine.ts` provides a lightweight finite-state workflow runner for browser automation.

Core features:

- ordered step registration with `addStep()`
- sequential execution with `run()`
- concurrent execution with `runParallel()`
- per-step retries and timeouts
- completion and failure hooks
- JSON-safe `exportState()` and `importState()` for recovery

`main.ts` now demonstrates the pattern by running the publish flow through `TaskEngine` instead of sequencing it inline.

## Memory Store

`memory_store.ts` provides a SQLite-backed key-value store using Node's built-in `node:sqlite` module.

Capabilities:

- generic `get`, `set`, `delete`, `keys`, and `clear`
- TTL support
- logical collections via key prefixes such as `sessions:`, `task_state:`, `proxy_stats:`, and `captcha_stats:`
- `npx ts-node memory_store.ts stats` for store inspection
- helpers for saving and restoring cookies on automation-owned contexts

When you pass `memoryStore` and `sessionKey` into `createAutomationContext()`, the context will restore cookies before use and persist them again on close.

## AI Agent

`ai_agent.ts` adds an OpenRouter-driven reasoning loop for open-ended browser goals.

Capabilities:

- `observeAndDescribe()` for structured page summaries
- `findElement()` for selector-free element lookup
- `executeGoal()` for bounded autonomous action loops
- `createGoalTask()` to wrap an AI goal as a `TaskEngine` task

Environment:

- `OPENROUTER_API_KEY`
- `AI_AGENT_MODEL` or `OPENROUTER_MODEL`
- `OPENROUTER_BASE_URL` (optional)

## Telemetry And Reports

`telemetry.ts` collects structured runtime events and can export reports as JSON, Markdown, or HTML.

Capabilities:

- per-action metrics with durations and success/error status
- alert hooks
- Telegram integration via the existing `telegram_notifier.ps1`
- timestamped report persistence under `reports/`

`main.ts` now saves Markdown and JSON reports automatically after a run.

## Health Checks

`health_check.ts` provides startup diagnostics for the runtime layer.

Built-in checks include:

- CDP connectivity
- memory store read/write/delete
- proxy pool availability when proxies are configured
- CAPTCHA configuration when CAPTCHA features are enabled
- OpenRouter configuration when AI features are enabled
- disk space
- placeholder skill checks

Use `runAll()` for a full report and `runCritical()` when startup should fail fast on critical issues.

## Scheduler

`scheduler.ts` provides a manual 5-field cron scheduler with persistence.

Supported cron syntax:

- `*`
- `*/N`
- single numbers
- comma-separated lists

Capabilities:

- schedule, unschedule, pause, and resume tasks
- persisted schedule metadata through `MemoryStore`
- runtime task-factory registry for restored schedules
- UTC killzone helper for London, NY, and Asia windows

## Daemon Runtime

`daemon.ts` is the long-running runtime owner for the framework.

Lifecycle responsibilities:

- run health checks before startup
- initialize or accept `MemoryStore`, `Telemetry`, and `HealthCheck`
- start the scheduler
- start the broker server
- write `~/.browser-control/.interop/daemon.pid`
- emit heartbeat logs
- track submitted task status
- stop gracefully and persist reports/state on shutdown

Scripts:

```bash
npm run daemon
npm run daemon:dev
```

## Broker Runtime

`broker_server.ts` is now a real HTTP/WebSocket runtime surface instead of a stub.

Endpoints:

- `POST /api/v1/tasks/run`
- `POST /api/v1/tasks/schedule`
- `GET /api/v1/tasks/:id/status`
- `GET /api/v1/tasks`
- `POST /api/v1/kill`
- `GET /api/v1/health`
- `GET /api/v1/stats`
- `GET /api/v1/scheduler`

Broker features:

- API key auth via `BROKER_API_KEY` with fallback to `BROKER_SECRET`
- CORS support via `BROKER_ALLOWED_ORIGINS`
- allowlist enforcement via `BROKER_ALLOWED_DOMAINS`
- per-IP rate limiting
- WebSocket task completion events at `/ws`
- `GET /api/v1/skills` for listing registered skill manifests
- `POST /api/v1/tasks/run` with `skill` field routes execution through the skill system

## Skill Plugin System

The skill plugin system provides a generic `Skill` interface for encapsulating domain-specific browser automation logic.

### Interfaces

```typescript
interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  requiredEnv: string[];
  allowedDomains: string[];
}

interface SkillContext {
  page: Page;
  data: Record<string, unknown>;
  memoryStore: MemoryStore;
  telemetry: Telemetry;
  captchaSolver?: CaptchaSolver;
  aiAgent?: AIAgent;
}

interface Skill {
  readonly manifest: SkillManifest;
  setup(context: SkillContext): Promise<void>;
  execute(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  teardown(context: SkillContext): Promise<void>;
  healthCheck(context: SkillContext): Promise<{ healthy: boolean; details?: string }>;
}
```

### Creating a New Skill

1. Create a new file under `skills/` implementing the `Skill` interface:

```typescript
// skills/my_skill.ts
import type { Skill, SkillContext, SkillManifest } from "../skill";

const manifest: SkillManifest = {
  name: "my-skill",
  version: "1.0.0",
  description: "Automates my-domain actions.",
  requiredEnv: [],
  allowedDomains: ["example.com"],
};

export const mySkill: Skill = {
  manifest,

  async setup(context: SkillContext): Promise<void> {
    console.log(`[MY_SKILL] Setup for page: ${context.page.url()}`);
  },

  async execute(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (action) {
      case "doSomething":
        return { success: true };
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },

  async teardown(_context: SkillContext): Promise<void> {
    console.log("[MY_SKILL] Teardown.");
  },

  async healthCheck(_context: SkillContext): Promise<{ healthy: boolean; details?: string }> {
    return { healthy: true };
  },
};

export default mySkill;
```

2. Register the skill with the `SkillRegistry`:

```typescript
import { SkillRegistry } from "./skill_registry";
import { mySkill } from "./skills/my_skill";

const registry = new SkillRegistry();
registry.register(mySkill);
```

3. Connect to the broker server by providing `listSkills` and `executeSkill` callbacks:

```typescript
const broker = createBrokerServer({
  callbacks: {
    listSkills: () => registry.list(),
    executeSkill: (name, action, params) => registry.execute(name, action, params),
  },
});
```

4. Call via the HTTP API:

```bash
# List available skills
curl http://127.0.0.1:7788/api/v1/skills

# Execute a skill action
curl -X POST http://127.0.0.1:7788/api/v1/tasks/run \
  -H "Content-Type: application/json" \
  -d '{"skill":"my-skill","action":"doSomething","params":{}}'
```

### Auto-Discovery

Skills in the `skills/` directory are auto-discovered by the daemon on startup.
Each `.ts` file can export a default or named `xxxSkill` object implementing the `Skill` interface.

```typescript
// skills/my_skill.ts
import type { Skill, SkillContext, SkillManifest } from "../skill";

export function createMySkill(): Skill {
  let ctx: SkillContext | undefined;
  return {
    manifest: {
      name: "my-skill",
      version: "1.0.0",
      description: "Does something useful",
      requiredEnv: [],
      allowedDomains: ["example.com"],
    },
    async setup(context: SkillContext) {
      ctx = context; // Store context for use in execute
    },
    async execute(action: string, params: Record<string, unknown>) {
      const page = ctx!.page; // Use page from context
      // ... do work
      return { success: true };
    },
    async teardown() { ctx = undefined; },
    async healthCheck() { return { healthy: true }; },
  };
}

export const mySkill = createMySkill();
export default mySkill;
```

### Built-in Skills

- **framer** — Framer editor actions: publish, CMS, breakpoints, panels
- **exness** — Exness platform automation
- **adobe_stock** — Adobe Stock contributor workflow

## Multi-Session Support with StagehandManager

`StagehandManager` replaces the global singleton pattern with explicit session management, enabling concurrent browser sessions.

```typescript
import { StagehandManager } from "@bc/stagehand_core";

const manager = new StagehandManager();

// Create a new session (needs CDP port and URL pattern)
const session = await manager.createSession("session-1", 9222, "example.com");

// Access the page
const page = session.page;
await page.goto("https://example.com");

// Use Stagehand AI actions in a session
await manager.actInSession("session-1", "Click the login button");
const observations = await manager.observeInSession("session-1");

// List active sessions
const sessions = manager.listSessions();

// Destroy a specific session
await manager.destroySession("session-1");

// Close all sessions (useful during daemon shutdown)
await manager.closeAll();
```

Legacy functions (`getActiveStagehand`, `connectStagehand`) remain available for backward compatibility — they operate on a default session.

## Network Interception

`NetworkInterceptor` provides route-level interception for capturing, blocking, and mocking network traffic.
All methods take `page` as the first argument — a single interceptor can work across multiple pages.

```typescript
import { NetworkInterceptor, RouteHandler } from "./network_interceptor";

const interceptor = new NetworkInterceptor();

// Intercept with a RouteHandler
await interceptor.intercept(page, {
  urlPattern: "**/api/v1/tracking",
  action: "abort", // block tracking requests
});

// Or fulfill with mock data
await interceptor.intercept(page, {
  urlPattern: "**/api/v1/config",
  action: "fulfill",
  fulfillOptions: {
    status: 200,
    body: { featureFlags: { enabled: true } },
    contentType: "application/json",
  },
});

// Remove an intercept
await interceptor.removeIntercept(page, "**/api/v1/tracking");

// Capture responses matching a pattern
await interceptor.captureResponse(page, "**/api/v1/data");

// Wait for a specific API response
const apiData = await interceptor.waitForApiResponse(page, "**/api/v1/results", { timeoutMs: 10000 });

// Capture just the JSON body
const json = await interceptor.captureJsonResponse(page, "**/api/v1/users");

// Standalone helpers (create their own interceptor internally)
import { captureJsonResponse, blockResource, mockResponse } from "./network_interceptor";

const data = await captureJsonResponse(page, "**/api/v1/data", 5000);
await blockResource(page, "**/*.png");
await mockResponse(page, "**/api/test", { body: { ok: true } });
```

## File Upload and Download

`file_helpers.ts` provides utilities for managing file transfers during automation.

```typescript
import { DownloadManager, uploadFile, uploadFiles, uploadWithDragDrop } from "./file_helpers";

// Download management
const dm = new DownloadManager("./downloads");

// Wait for the next download triggered by the page
const result = await dm.waitForDownload(page, 30000);
console.log(`Downloaded: ${result.fileName} (${result.sizeBytes} bytes)`);

// Start capturing all downloads from a page into a directory
await dm.captureDownloads(page, "./my-downloads");

// Trigger a download by clicking
const download = await dm.downloadByClick(page, "#download-button");

// Get all pending download promises
const pending = dm.getPendingDownloads();
await Promise.all(pending);

// Upload a single file to a file input
await uploadFile(page, "#file-input", "/path/to/file.pdf");

// Upload multiple files
await uploadFiles(page, "#multi-input", ["/path/a.pdf", "/path/b.pdf"]);

// Upload via drag-and-drop
await uploadWithDragDrop(page, "#drop-zone", "/path/to/file.pdf");

// Validate a file path before use
import { validateFilePath } from "./file_helpers";
const safePath = validateFilePath("/path/to/file.pdf");
// Returns the absolute path or throws if the file doesn't exist
```

`DownloadManager` handles concurrent download limits, progress tracking, and automatic cleanup on failure.
