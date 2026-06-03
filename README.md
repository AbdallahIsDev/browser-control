<div align="center">
  <h1>🖥️ Browser Control</h1>
  <p><strong>Browser Control is a reusable browser workflow runtime for AI agents.</strong></p>
  <p>Turn successful browser tasks into Automation Packages that can be replayed, repaired, reviewed, and shared.</p>

  <a href="https://www.npmjs.com/package/@abdallahisdev/browser-control"><img src="https://img.shields.io/npm/v/@abdallahisdev/browser-control?color=blue" alt="npm version"></a>
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

Browser Control gives any AI agent the ability to use a web browser and do real-world tasks for you.

Instead of just talking to you, your AI can now open web pages, click buttons, fill out forms, and handle boring online chores directly on your computer. It does all this while following strict safety rules, so you are always in complete control.

It works with Codex/Claude Code or other existing agents to turn repeated browser tasks into reusable Automation Packages.

| Domain | Capabilities |
|--------|-------------|
| **🌐 Browser** | Navigate, snapshot (accessibility tree with stable `@e3` refs), click, fill, hover, type, press keys, scroll, screenshot, tab management, screencast recording. Powered by Chromium/CDP via Playwright. |
| **💻 Terminal** | Persistent PTY sessions (open/exec/read/write/interrupt/close/resume), command execution, output capture. Cross-platform via `node-pty`. |
| **📁 Filesystem** | Structured read/write/list/move/delete/stat — policy-governed, not shell emulation. |

Every action is gated by a **policy engine** (`safe` / `balanced` / `trusted` profiles) and returns a structured `ActionResult` with success/failure, risk level, and optional debug evidence.

Public integration is CLI-first and MCP-first. The TypeScript API is available for embedding. The web dashboard and Electron desktop app remain experimental/internal operator surfaces until they are stable and redesigned around Automation Packages.

> **Not a native desktop GUI automation product.** The browser path targets Chromium/CDP and semantic accessibility snapshots. It does not automate native OS windows or non-browser desktop apps.

<br/>

## 🎬 Demos

### MIMO Research Demo — AI-powered web research with MCP tools

<video src="https://github.com/user-attachments/assets/47fc88ce-4b86-4112-a99a-c4bbdcfb19f2" controls autoplay muted loop width="100%"></video>

### MCP Server Demo — AI Agent controlling browser + terminal + filesystem via MCP

<video src="https://github.com/user-attachments/assets/bb9cd071-9f50-44de-8012-6d3bfdc7a1a1" controls autoplay muted loop width="100%"></video>

### MiMo by Xiaomi

Tested with Browser Control workflow automation tasks, including browser navigation, form filling, information extraction, and report generation. MiMo demonstrated solid performance on structured multi-step workflows.

> [Xiaomi MiMo](https://platform.xiaomimimo.com/docs/en-US/welcome) · [MiMo on Hugging Face](https://huggingface.co/XiaomiMiMo)

<br/>

## ⚡ Quick Start

**Prerequisite:** Node.js `>= 22`

```powershell
npm install -g @abdallahisdev/browser-control
bc --help
```

From source (development):

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
bc package list
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
bc browser state --json
bc browser open https://example.com --json
bc browser snapshot --json
bc browser act click "@e3" --capture-on-success --json
bc browser task run --steps='[{"action":"open","url":"https://example.com"},{"action":"state","snapshot":true}]' --json

# Auth state + profiles
bc browser profile create work --type named
bc browser auth export auth-state.json --live
bc browser auth import auth-state.json --stored
```

<br/>

## ⚡ Agent Execution Model

For Codex, Claude Code, OpenCode, Hermes, OpenClaw, and any agent that can run shell commands, use CLI-first automation:

```powershell
bc status --json
bc browser state --json
bc browser open https://example.com --json
bc browser snapshot --json
bc browser act fill searchInput "Amazon" --json
bc browser act click "@e3" --capture-on-success --json
bc browser task run --steps='[{"action":"open","url":"https://example.com"},{"action":"state"}]' --json
```

Why CLI first:

- fewer tool calls and fewer LLM-visible requests
- compact structured `ActionResult` output
- same policy/audit path as MCP/API
- better batching through `bc browser task run`

Use MCP Lite when the client is MCP-native or cannot run CLI. Use full MCP when a task needs the complete tool surface.

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
| **Status** | `bc_status` |
| **Session** | `bc_session_create`, `bc_session_list`, `bc_session_select`, `bc_session_status` |
| **Browser** | `bc_open`, `bc_snapshot`, `bc_act`, `bc_task_run`, `bc_tab_list`, `bc_screenshot`, `bc_close` |
| **Terminal** | `bc_terminal_open`, `bc_terminal_exec`, `bc_terminal_read`, `bc_terminal_write`, `bc_terminal_interrupt`, `bc_terminal_snapshot`, `bc_terminal_list`, `bc_terminal_resume`, `bc_terminal_status` |
| **Filesystem** | `bc_fs_read`, `bc_fs_write`, `bc_fs_list`, `bc_fs_move`, `bc_fs_delete`, `bc_fs_stat`, `bc_fs_write_output` |
| **Network + Vault** | `bc_network_rules_list`, `bc_network_blocked_requests`, `bc_vault_list` |
| **Debug** | `bc_debug_health`, `bc_debug_failure_bundle`, `bc_debug_get_console`, `bc_debug_get_network` |
| **Service** | `bc_service_list`, `bc_service_resolve` |
| **Workflow** | `bc_workflow_run`, `bc_workflow_status`, `bc_workflow_resume`, `bc_workflow_approve`, `bc_workflow_cancel`, `bc_workflow_events`, `bc_workflow_edit_state` |
| **Harness** | `bc_harness_list`, `bc_harness_find_helper`, `bc_harness_validate_helper`, `bc_harness_rollback`, `bc_harness_generate`, `bc_harness_execute` |
| **Packages** | `bc_package_install`, `bc_package_list`, `bc_package_info`, `bc_package_update`, `bc_package_remove`, `bc_package_run`, `bc_package_eval`, `bc_package_grant`, `bc_package_review`, `bc_package_review_history`, `bc_package_eval_history` |

Full tool reference: [docs/mcp.md](docs/mcp.md)

### MCP Lite

MCP Lite exposes a smaller high-level toolset for lower token overhead:

`bc_navigate`, `bc_snapshot`, `bc_act`, `bc_task_run`, `bc_tab_list`, `bc_fs_write_output`, `bc_session_status`, `bc_status`

Set `BROWSER_CONTROL_MCP_MODE=lite` or run `bc mcp serve --mode=lite` for Lite mode. Full MCP mode keeps the complete tool surface.

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
│   ├── providers/              # local-first browser providers; remote providers are opt-in internals
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
import { createBrowserControl } from "@abdallahisdev/browser-control";

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

## 🖥️ Experimental Operator UI

Browser Control includes a token-gated local web dashboard and an Electron wrapper in the repository, but they are **not the main product surface** and are not positioned as stable production UI yet.

Use CLI/MCP for normal agent integration. Treat dashboard/desktop as experimental internal operator interfaces.

```powershell
npm run web:dev           # Experimental dashboard dev mode
npm run web:build         # Build experimental dashboard assets
bc web open               # Internal loopback operator UI
npm run desktop:dev       # Experimental Electron wrapper
```

Dashboard direction is package-first: Package Library, Run Automation Package, Create Package from Successful Run, Run History, Evidence Viewer, Repair Failed Package, Permissions/Risk Review, and tool-call/time/token savings. Dashboard/Desktop remain experimental operator surfaces.

<br/>

## 🧰 CLI Highlights

Browser Control has a broad CLI surface for both operators and agents. Common areas:

- `setup`, `doctor`, `status`, `config`
- `open`, `snapshot`, `click`, `fill`, `screenshot`
- `browser launch|attach|list|state|act|task|provider|profile|auth`
- `term open|exec|read|snapshot|interrupt|resume`
- `fs read|write|ls|move|rm|stat`
- `service register|list|resolve|remove`
- `daemon start|stop|status|health|logs`
- `run` and `schedule` for queued tasks and recurring automations
- `debug`, `policy`, `knowledge`, `memory`, `report`, and package/workflow commands

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
| 🧪 Web dashboard (React/Vite) | Experimental/internal |
| 🧪 Electron desktop app | Experimental/internal |
| 🔄 Self-healing harness | Active |
| ✅ Workflow graph runtime, events, helpers | Active |
| ✅ Automation packages, trust review, evals | Active |
| 🧪 Remote providers | Experimental/opt-in |
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
| [Automation Packages](docs/packages.md) | Package-first workflow model and commands |
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
  <strong>Turn repeated browser tasks into reusable Automation Packages.</strong>
</div>
