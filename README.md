<div align="center">
  <h1>🖥️ Browser Control</h1>
  <p><strong>Unified browser, terminal, filesystem, and MCP automation engine for AI agents.</strong></p>

  <a href="https://www.npmjs.com/package/browser-control"><img src="https://img.shields.io/npm/v/browser-control?color=blue" alt="npm version"></a>
  <img width="8" alt="">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT"></a>
  <img width="8" alt="">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js >= 22"></a>
  <img width="8" alt="">
  <a href="https://github.com/AbdallahIsDev/browser-control"><img src="https://img.shields.io/github/stars/AbdallahIsDev/browser-control?style=social" alt="GitHub stars"></a>
  <img width="8" alt="">
  <a href="./docs/support-matrix.md"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey" alt="Platforms"></a>
  <br/><br/>
  <img src="https://img.shields.io/badge/status-pre--release%20%7C%20active%20development-yellow" alt="Status: pre-release">
</div>

<br/>

## What It Does

Browser Control is a **local automation engine** that gives AI agents and operators one policy-governed surface across three domains:

| Domain | Capabilities |
|--------|-------------|
| **🌐 Browser** | Navigate, snapshot (accessibility tree with stable `@e3` refs), click, fill, hover, type, press keys, scroll, screenshot, tab management, screencast recording. Powered by Chromium/CDP via Playwright. |
| **💻 Terminal** | Persistent PTY sessions (open/exec/read/write/interrupt/close/resume), command execution, output capture. Cross-platform via `node-pty`. |
| **📁 Filesystem** | Structured read/write/list/move/delete/stat — policy-governed, not shell emulation. |

Every action is gated by a **policy engine** (`safe` / `balanced` / `trusted` profiles) and returns a structured `ActionResult` with success/failure, risk level, and optional debug evidence.

It exposes this surface through **five execution surfaces**: CLI (`bc`), TypeScript API, MCP server, web dashboard, and Electron desktop app.

> **Not a native desktop GUI automation product.** The browser path targets Chromium/CDP and semantic accessibility snapshots. It does not automate native OS windows or non-browser desktop apps.

<br/>

## 🎬 Demos

| Demo | Description | Duration |
|------|-------------|----------|
| ▶️ **[MCP Server Demo](demos/browser-control-mcp-demo.mp4)** | AI Agent controlling browser + terminal + filesystem via MCP tools — navigate, snapshot, click, fill forms, run terminal commands, read/write files | ~20 MB MP4 |
| ▶️ **[MIMO Research Demo](demos/browser-control-mcp-mimo-research-demo.mp4)** | AI-powered web research with MCP tools — multi-step research workflow, data extraction, and evidence collection | ~18 MB MP4 |

> **Tip:** Click the demo name to download and watch. Right-click → "Save link as..." to download. Videos show real Browser Control MCP workflows.

<br/>

## ⚡ Quick Start

**Prerequisite:** Node.js `>= 22`

```powershell
git clone https://github.com/AbdallahIsDev/browser-control.git
cd browser-control
npm install
npm run typecheck
npm run build
npm link              # Makes `bc` command globally available
```

First setup:

```powershell
bc setup --non-interactive --profile balanced
bc doctor
bc status
```

**WSL users:** Run `sh scripts/install_wsl_bc.sh` if `bc` resolves to the Linux calculator instead.

Runtime data lives under `%USERPROFILE%\.browser-control` (Windows) or `~/.browser-control` (Unix). Override with `BROWSER_CONTROL_HOME`.

### First Workflow

```powershell
# Terminal + Filesystem
bc session create demo --policy balanced
bc term exec "node --version" --json
bc fs ls . --json

# Browser
bc browser launch --port 9222 --profile default
bc open https://example.com
bc snapshot
bc screenshot
bc click "@e3"
```

<br/>

## 🔌 MCP Server — AI Agent Integration

Browser Control exposes its full action surface as an MCP stdio server. AI agents (Claude Desktop, Codex, Cursor, etc.) can control your local browser, terminal, and filesystem through it.

```json
{
  "mcpServers": {
    "bc": {
      "command": "bc",
      "args": ["mcp", "serve"]
    }
  }
}
```

### Tool Categories (66 tools)

| Category | Key Tools |
|----------|----------|
| **Status** | `status` — daemon, broker, sessions, services, policy, health |
| **Session** | `bc_session_create`, `list`, `select`, `status` |
| **Browser** | `open`, `snapshot`, `click`, `fill`, `hover`, `type`, `press`, `scroll`, `screenshot`, `tab_list/switch/close`, `screencast_start/stop`, `highlight`, `generate_locator` |
| **Terminal** | `terminal_exec`, `terminal_open`, `read`, `write`, `interrupt`, `snapshot`, `list`, `close`, `resume` |
| **Filesystem** | `fs_read`, `fs_write`, `fs_list`, `move`, `delete`, `stat` |
| **Debug** | `debug_health`, `debug_failure_bundle`, `get_console`, `get_network` |
| **Provider** | `bc_browser_provider_list`, `use` (local, custom CDP, browserless) |
| **Service** | `bc_service_list`, `resolve` |
| **Workflow** | `bc_workflow_run`, `status`, `resume`, `approve`, `cancel` |
| **Harness** | `bc_harness_list`, `find_helper`, `validate_helper`, `rollback` |
| **Packages** | `bc_package_list`, `info`, `run`, `eval`, `grant` |

Full tool reference: [docs/mcp.md](docs/mcp.md)

### Security with MCP

MCP clients are powerful — they can run commands, read/write files, and control browser pages with your logged-in sessions. Use `safe` or `balanced` policy for untrusted agents, scope working directories, and review destructive actions.

<br/>

## 🏗️ Architecture

```
browser-control/
├── src/                        # Production TypeScript
│   ├── browser/                # CDP/Playwright browser automation
│   ├── terminal/               # PTY-based native terminal
│   ├── filesystem/             # Policy-governed FS operations
│   ├── policy/                 # Risk-based policy engine
│   ├── mcp/                    # MCP server + tool registry
│   ├── runtime/                # Daemon, broker, health, scheduler
│   ├── observability/          # Debug bundles, console/network capture
│   ├── operator/               # Doctor, setup, dashboard
│   ├── providers/              # local / custom CDP / browserless
│   ├── services/               # bc:// service registry
│   ├── workflows/              # Workflow graph runtime
│   ├── harness/                # Self-healing helper registry
│   ├── packages/               # Automation package system
│   └── knowledge/              # Markdown artifact storage
├── web/                        # React 19 + Vite dashboard
├── desktop/                    # Electron wrapper
├── tests/                      # Unit, E2E, compatibility
├── docs/                       # Full documentation
├── examples/                   # Golden workflow examples
└── automation-packages/        # Example packages
```

**Three execution paths:**

- **`command`** — terminal, filesystem, process, service, and local system work
- **`a11y`** — browser accessibility snapshots with stable refs (`@e3`)
- **`low_level`** — CDP, DOM, network, and browser fallback

**Technology stack:** TypeScript, Node.js ≥22, Playwright, node-pty, SQLite (built-in), React 19, Vite 8, Electron 41, Zod, ws v8, @modelcontextprotocol/sdk.

See the full architecture: [docs/architecture/source-layout.md](docs/architecture/source-layout.md) | [docs/architecture/overview.md](docs/architecture/overview.md)

<br/>

## 📚 TypeScript API

```typescript
import { createBrowserControl } from "browser-control";

const bc = createBrowserControl({ policyProfile: "balanced" });

const result = await bc.browser.open("https://example.com");
const snapshot = await bc.browser.snapshot();
await bc.browser.click("@e3");
await bc.browser.screenshot({ output: "./page.png" });

const { stdout } = await bc.terminal.exec("node --version");
await bc.fs.write({ path: "./output.txt", content: "hello" });
```

Full API reference: [docs/api.md](docs/api.md)

<br/>

## 🖥️ Dashboard & Desktop App

Browser Control includes a **web dashboard** (React + Vite) served on loopback and an **Electron desktop app**.

```powershell
npm run web:dev           # Dev dashboard
npm run web:build         # Build for production
bc web open               # Launch in browser
npm run desktop:dev       # Electron dev mode
npm run desktop:build     # Package Electron app
```

<br/>

## 🗺️ Roadmap

| Area | Status |
|------|--------|
| ✅ Browser CDP automation | Stable |
| ✅ Accessibility snapshots | Stable |
| ✅ Native terminal (PTY) | Stable |
| ✅ Filesystem operations | Stable |
| ✅ Policy engine (safe/balanced/trusted) | Stable |
| ✅ MCP server (66 tools) | Stable |
| ✅ CLI (`bc` command) | Stable |
| ✅ TypeScript API | Stable |
| ✅ Service registry (`bc://`) | Stable |
| ✅ Debug bundles + observability | Stable |
| ✅ Web dashboard (React/Vite) | Stable |
| ✅ Electron desktop app | Stable |
| 🔄 Self-healing harness | Active |
| 🔄 Workflow graphs | Active |
| 🔄 Automation packages | Active |
| 🔄 Remote providers (browserless) | Active |
| 🎯 Production hardening | Planned |
| 🎯 Cross-platform package publishing | Planned |

See detailed roadmap: [docs/specs/v1-roadmap.md](docs/specs/v1-roadmap.md) | Production upgrade tracker: [docs/production-upgrade/STATUS.md](docs/production-upgrade/STATUS.md)

<br/>

## 🔒 Security

Browser Control runs with the same authority as your user account. Treat it accordingly.

- **Three policy profiles:** `safe` (denies high/critical), `balanced` (confirms high/critical, default), `trusted` (audits high, confirms critical)
- **Secrets redaction:** Provider tokens, CAPTCHA keys, and OpenRouter keys are redacted from config output
- **MCP security:** Only connect trusted agents. Use `safe`/`balanced` policy, scope working directories, avoid storing tokens in prompts
- **Dedicated browser profiles:** Recommended — use `BROWSER_LAUNCH_PROFILE=isolated` for automation

Full security documentation: [SECURITY.md](SECURITY.md) | [docs/security.md](docs/security.md)

<br/>

## 📖 Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](docs/getting-started.md) | Prerequisites, setup, first workflows |
| [CLI Reference](docs/cli.md) | Full `bc` command reference (100+ subcommands) |
| [TypeScript API](docs/api.md) | `createBrowserControl()` API surface |
| [MCP Setup & Tools](docs/mcp.md) | MCP server config + all 66 tools |
| [Architecture Overview](docs/architecture/overview.md) | System architecture, data flow, component map |
| [Source Layout](docs/architecture/source-layout.md) | Directory structure and conventions |
| [Browser Behavior](docs/browser.md) | Modes, profiles, CDP, remote providers |
| [Terminal & Filesystem](docs/terminal.md) | PTY sessions, FS operations |
| [Configuration](docs/configuration.md) | All config keys, env vars, runtime paths |
| [Security Model](docs/security.md) | Trust boundaries, policy, secrets, MCP security |
| [Policy Guide](docs/policy.md) | Policy profiles and risk evaluation |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Support Matrix](docs/support-matrix.md) | Platform and feature support |
| [Compatibility](docs/compatibility.md) | Semver, breaking changes, deprecation |
| [WSL + Windows Chrome](docs/wsl-windows-chrome.md) | WSL-specific browser setup |
| [Examples](docs/examples/) | Copy-pasteable CLI, API, MCP examples |

<br/>

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards, and [docs/release-checklist.md](docs/release-checklist.md) for the release process.

<br/>

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

<br/>

<div align="center">
  <strong>Tell your agent what to do, and Browser Control gets it done.</strong>
</div>
