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

It exposes this surface through **five operator surfaces**: CLI (`bc`), TypeScript API, MCP server, authenticated local web dashboard, and Electron desktop app.

> **Not a native desktop GUI automation product.** The browser path targets Chromium/CDP and semantic accessibility snapshots. It does not automate native OS windows or non-browser desktop apps.

<br/>

## 🎬 Demos

### MIMO Research Demo — AI-powered web research with MCP tools

<video src="https://github.com/user-attachments/assets/47fc88ce-4b86-4112-a99a-c4bbdcfb19f2" controls autoplay muted loop width="100%"></video>

### MCP Server Demo — AI Agent controlling browser + terminal + filesystem via MCP

<video src="https://github.com/user-attachments/assets/bb9cd071-9f50-44de-8012-6d3bfdc7a1a1" controls autoplay muted loop width="100%"></video>

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
bc web open
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

# Auth state + profiles
bc browser profile create work --type named
bc browser auth export auth-state.json --live
bc browser auth import auth-state.json --stored
```

<br/>

## 🔌 MCP Server — AI Agent Integration

Browser Control exposes its full action surface as an MCP stdio server. AI agents (Claude Desktop, Codex, Cursor, etc.) can control your local browser, terminal, filesystem, workflows, packages, and operator services through it.

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

### Tool Categories

| Category | Key Tools |
|----------|----------|
| **Status** | `status`, `bc_status` |
| **Session** | `bc_session_create`, `bc_session_list`, `bc_session_select`, `bc_session_status` |
| **Browser** | Short aliases such as `open`, `snapshot`, `click`, `fill`, `screenshot`, plus `bc_browser_launch`, `attach`, `list`, `hover`, `type`, `press`, `scroll`, `downloads_list`, `drop`, `highlight`, `generate_locator`, `screencast_*`, `provider_*` |
| **Terminal** | `terminal_open`, `terminal_exec`, `bc_terminal_read`, `write`, `interrupt`, `snapshot`, `list`, `resume`, `status` |
| **Filesystem** | `fs_read`, `fs_write`, `fs_list`, `bc_fs_move`, `delete`, `stat` |
| **Network + Vault** | `bc_network_rules_list`, `bc_network_blocked_requests`, `bc_vault_list` |
| **Debug** | `debug_health`, `debug_failure_bundle`, `bc_debug_get_console`, `bc_debug_get_network` |
| **Service** | `bc_service_list`, `bc_service_resolve` |
| **Workflow** | `bc_workflow_run`, `status`, `resume`, `approve`, `cancel`, `events`, `edit_state` |
| **Harness** | `bc_harness_list`, `find_helper`, `validate_helper`, `rollback`, `generate`, `execute` |
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
│   ├── observability/          # Debug bundles, console/network capture, recording, visual diff
│   ├── operator/               # Doctor, setup, dashboard
│   ├── providers/              # local / custom CDP / browserless
│   ├── services/               # bc:// registry and optional .localhost proxy
│   ├── security/               # credential vault, network rules, redaction
│   ├── state/                  # SQLite-backed durable state
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

**Technology stack:** TypeScript, Node.js ≥22, Playwright, node-pty, SQLite, React 19, Vite, Electron 41, Zod, ws, @modelcontextprotocol/sdk.

See the full architecture: [docs/architecture/source-layout.md](docs/architecture/source-layout.md) | [docs/architecture/overview.md](docs/architecture/overview.md)

<br/>

## 📚 TypeScript API

```typescript
import { createBrowserControl } from "browser-control";

const bc = createBrowserControl({ policyProfile: "balanced" });

const result = await bc.browser.open({ url: "https://example.com" });
const snapshot = await bc.browser.snapshot();
await bc.browser.click({ target: "@e3" });
await bc.browser.screenshot({ outputPath: "./page.png" });

const term = await bc.terminal.exec({ command: "node --version" });
await bc.fs.write({ path: "./output.txt", content: "hello" });
await bc.close();
```

Full API reference: [docs/api.md](docs/api.md)

<br/>

## 🖥️ Dashboard & Desktop App

Browser Control includes a **token-gated local web dashboard** (React + Vite) served on loopback and an **Electron desktop app**.

```powershell
npm run web:dev           # Dev dashboard
npm run web:build         # Build for production
bc web open               # Open dashboard with one-time local auth token
bc web open --port=0      # Fallback when port 7790 is busy
npm run cli -- web open   # Source checkout equivalent
npm run desktop:dev       # Electron dev mode
npm run desktop:build     # Package Electron app into dist-desktop\win-unpacked\
```

Current dashboard areas include runtime status, tasks, browser/provider state, workflows, packages, evidence, settings, and advanced maintenance actions.

<br/>

## 🧰 CLI Highlights

Browser Control has a broad CLI surface for both operators and agents. Common areas:

- `setup`, `doctor`, `status`, `config`
- `open`, `snapshot`, `click`, `fill`, `screenshot`
- `browser launch|attach|list|provider|profile|auth`
- `term open|exec|read|snapshot|interrupt|resume`
- `fs read|write|ls|move|rm|stat`
- `service register|list|resolve|remove`
- `daemon start|stop|status|health|logs`
- `run` and `schedule` for queued tasks and recurring automations
- `debug`, `policy`, `knowledge`, `proxy`, `memory`, `skill`, `report`, `captcha`

Full command reference: [docs/cli.md](docs/cli.md)

<br/>

## 🗺️ Roadmap

| Area | Status |
|------|--------|
| ✅ Browser CDP automation | Stable |
| ✅ Accessibility snapshots | Stable |
| ✅ Native terminal (PTY) | Stable |
| ✅ Filesystem operations | Stable |
| ✅ Policy engine (safe/balanced/trusted) | Stable |
| ✅ MCP server | Stable |
| ✅ CLI (`bc` command) | Stable |
| ✅ TypeScript API | Stable |
| ✅ Service registry (`bc://`) | Stable |
| ✅ Debug bundles + observability | Stable |
| ✅ Web dashboard (React/Vite) | Stable |
| ✅ Electron desktop app | Stable |
| 🔄 Self-healing harness | Active |
| ✅ Workflow graph runtime, events, helpers | Active |
| ✅ Automation packages, trust review, evals | Active |
| 🔄 Remote providers (browserless and custom CDP) | Active |
| 🎯 Production hardening | Planned |
| 🎯 Cross-platform package publishing | Planned |

See detailed roadmap: [docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md](docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md) | Production upgrade tracker: [docs/production-upgrade/STATUS.md](docs/production-upgrade/STATUS.md)

<br/>

## 🔒 Security

Browser Control runs with the same authority as your user account. Treat it accordingly.

- **Three policy profiles:** `safe` (denies high/critical), `balanced` (confirms high/critical, default), `trusted` (audits high, confirms critical)
- **Secrets redaction:** Provider tokens, credential-vault secret refs, CAPTCHA keys, OpenRouter/model keys, and Browserbase URLs are redacted from CLI/API/MCP/UI output
- **MCP security:** Only connect trusted agents. Use `safe`/`balanced` policy, scope working directories, avoid storing tokens in prompts
- **Dedicated browser profiles:** Recommended — use `BROWSER_LAUNCH_PROFILE=isolated` for automation

Full security documentation: [SECURITY.md](SECURITY.md) | [docs/security.md](docs/security.md)

<br/>

## 📖 Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](docs/getting-started.md) | Prerequisites, setup, first workflows |
| [CLI Reference](docs/cli.md) | Full `bc` command reference |
| [TypeScript API](docs/api.md) | `createBrowserControl()` API surface |
| [MCP Setup & Tools](docs/mcp.md) | MCP server config + current tool surface |
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
