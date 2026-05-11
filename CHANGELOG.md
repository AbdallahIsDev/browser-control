# Changelog

All notable changes to Browser Control will be documented in this file.

## [1.0.0] — 2026-04-25

### 🎉 Initial Release (Pre-release / Active Development)

#### Core Engine
- ✅ Policy-governed action surface (safe/balanced/trusted)
- ✅ Three execution paths: command, a11y, low_level
- ✅ Structured `ActionResult` return type
- ✅ Session management with policy binding
- ✅ Daemon + broker runtime for persistent sessions
- ✅ SQLite-backed state persistence

#### Browser Automation
- ✅ Chromium/CDP browser control via Playwright
- ✅ Accessibility tree snapshots with stable refs (`@e3`)
- ✅ Click, fill, hover, type, press, scroll, screenshot
- ✅ Tab management (list, switch, close)
- ✅ Screencast recording with action timeline
- ✅ Browser profiles and auth state support
- ✅ Element highlight and locator generation
- ✅ Drop (file/data) and downloads tracking
- ✅ Provider system (local, custom CDP, browserless)

#### Terminal
- ✅ PTY-based persistent terminal sessions
- ✅ Open, exec, read, write, interrupt, close, resume
- ✅ Buffer snapshot and cursor state
- ✅ Cross-platform (Windows/Linux/macOS via node-pty)

#### Filesystem
- ✅ Read, write, list, move, delete, stat
- ✅ Policy-governed (risk-based gating)
- ✅ Directory auto-creation on write

#### MCP Server
- ✅ Full MCP stdio server (66 tools)
- ✅ 10 tool categories: status, session, browser, terminal, filesystem, debug, provider, service, workflow, harness
- ✅ Strict input validation (unknown params rejected)
- ✅ ActionResult JSON output shape
- ✅ Legacy `bc_*` and short alias tool names

#### CLI
- ✅ `bc` command with 100+ subcommands
- ✅ Setup, doctor, status, config, session management
- ✅ Browser launch, terminal, filesystem commands
- ✅ WSL support with Windows Chrome integration

#### TypeScript API
- ✅ `createBrowserControl()` top-level facade
- ✅ Namespaced API: `browser`, `terminal`, `fs`, `session`, `service`, `provider`, `debug`, `config`
- ✅ Full type exports

#### Observability
- ✅ Debug bundles with failure evidence
- ✅ Console capture (browser)
- ✅ Network capture (browser)
- ✅ Performance tracing
- ✅ Recovery guidance

#### Web Dashboard & Desktop
- ✅ React 19 + Vite web dashboard
- ✅ Electron 41 desktop wrapper
- ✅ Loopback-only Express backend

#### Workflow & Automation
- ✅ Linear workflow graph runtime (run/status/resume/approve/cancel)
- ✅ Self-healing harness with helper registry
- ✅ Automation package system (manifest, registry, runner, eval)

#### Documentation
- ✅ README with architecture overview
- ✅ 15+ docs files covering CLI, API, MCP, security, browser, terminal, config
- ✅ Examples directory with copy-pasteable workflows
- ✅ Support matrix and compatibility policy
- ✅ WSL-specific guide

### Known Limitations
- Chromium/CDP only — no native desktop GUI automation
- Requires local Chrome/Chromium or configured remote provider for browser features
- Terminal and filesystem actions can modify local machine state
- Pre-release status — APIs and tool names may change before stable release
