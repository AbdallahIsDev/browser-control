# FEATURES

This file is a code-audited feature inventory for the current worktree. It separates implemented surfaces from partial/limited surfaces and planned work. It should not be read as a stability guarantee; this project is still pre-release/active development.

Audit sources used: `src/`, `web/`, `desktop/`, `tests/`, `docs/production-upgrade/STATUS.md`, `premium-completion-tracker.md`, `PROBLEMS.md`, `README.md`, and live TypeScript introspection of API/MCP/config surfaces.

## PRODUCT DIRECTION WARNING

This is a feature inventory, not a product roadmap.

The strategic product direction is defined in `PRODUCT_DIRECTION.md`.

Browser Control should not be developed as a general AI coding app, IDE, or Codex/Claude Code replacement.

The strategic center is **reusable browser workflow automation through Automation Packages**.

Terminal, filesystem, MCP, dashboard, desktop, and model routing are supporting surfaces for package execution, evidence, repair, and operator control.

CLI/MCP are the production integration surfaces today. Dashboard and Electron desktop are experimental/internal operator interfaces until stable and redesigned around Automation Packages.

## STATUS KEY

| Status | Meaning |
|--------|---------|
| Implemented | Code exists in this worktree and has tests or direct API/CLI/MCP surface evidence. |
| Partial | Code exists, but important product polish, coverage, provider confirmation, or scope is incomplete. |
| Planned | Not implemented as a usable product feature in this worktree. |
| Long-term | Outside current v1 scope or intentionally deferred. |

## PRIORITY KEY

| Priority | Meaning |
|----------|---------|
| P0 | Core platform. |
| P1 | Critical operator/agent UX. |
| P2 | Production readiness and hardening. |
| P3 | Specialized, advanced, or non-core. |
| P4 | Future roadmap. |

---

## P0 - REUSABLE BROWSER WORKFLOW RUNTIME

### Policy Engine & Execution Router
Status: Implemented.

Three built-in policy profiles: `safe`, `balanced`, `trusted`. Risk levels: low, moderate, high, critical. Policy categories include command, filesystem, browser, low-level, credential, and privacy style controls. Execution routing supports command, accessibility, and low-level paths.

Known limits: current `PROBLEMS.md` still tracks broker/daemon filesystem sandbox bypass as not fixed in some paths.

### Canonical ActionResult Model
Status: Implemented.

Actions return structured success/failure results with path, risk, policy decision, audit metadata, warnings, and debug evidence where available.

### Browser Automation Engine
Status: Implemented.

Chromium/CDP automation through Playwright. Supports launch/attach/detach/list/status, open/navigate/openMany, click/fill/fillMany/hover/type/paste/press/scroll, screenshot, capture/captureMany, tab list/switch/close, close, downloads list, drag/drop, dialogs, CDP passthrough, locator generation, highlights, screencast lifecycle, state, `act`, and multi-step task runs.

### Multi-Tab Browser Workflows
Status: Implemented.

Durable tab IDs use CDP target IDs. `openMany`, tab-targeted `navigate`, `snapshot`, `screenshot`, `capture`, `captureMany`, `dialog`, `drop`, `cdp`, and compact `state` exist across API/CLI/MCP. Separate CLI processes can reconnect to active browser state.

Known limits: some advanced evidence/debug/network operations are not fully tab-targeted.

### Accessibility Snapshots & Semantic Refs
Status: Implemented.

Tree-based accessibility snapshots with stable refs such as `@e1`, semantic querying, ref resolution, bounds, formatted snapshot text, interactive counts, stale-ref handling, and snapshot diff support.

### Terminal Automation
Status: Implemented.

Persistent PTY sessions through `node-pty`. Supports open, exec, read, write/type, interrupt, close, snapshot, list, resume, status, resize, output subscription, prompt detection, CWD extraction, ANSI handling, serialization, persisted buffer store, and cross-platform shell detection.

Known limits: web terminal websocket reconnect is tracked as not fixed.

### Filesystem Operations
Status: Implemented.

Policy-governed read/write/list/move/delete/stat, directory auto-creation, process list/kill, symlink-aware delete hardening, path sandbox helpers, and `writeOutput` for session-scoped runtime output.

Known limits: broker/daemon filesystem routes still need the same sandbox guarantees as the action layer.

### Session Manager & Runtime Directories
Status: Implemented.

Sessions bind policy profile, working directory, browser/terminal/fs context, memory store, and audit context. Session state includes runtime, reports, screenshots, and artifacts directories.

### Configuration System
Status: Implemented.

Built-in defaults, user config, environment overrides, validation, and 33 audited config keys. Runtime data lives under Browser Control data home with config, memory, profiles, logs, reports, runtime, skills, knowledge, services, providers, debug bundles, and state.

Known limits: dashboard config mutation still needs a per-key allowlist for high-impact settings.

### Daemon & Broker
Status: Implemented.

Background daemon, health/status/logs, broker server, terminal IPC, API routes, daemon launch/cleanup helpers, generated broker API key, and local health endpoints.

Known limits: broker CORS defaults and some broker filesystem paths are still tracked for hardening.

### Durable State
Status: Implemented.

SQLite-backed durable state storage, recovery tests, profile migration, data-home safety checks, and memory-store backed runtime state.

### MCP Server
Status: Implemented.

Full MCP stdio server over `@modelcontextprotocol/sdk`. Current introspected full tool count: 88 tools across 11 categories. Lite mode exposes 14 high-level tools through `BROWSER_CONTROL_MCP_MODE=lite`. Schemas reject unknown parameters.

Current categories:

| Category | Count |
|----------|------:|
| status | 1 |
| session | 4 |
| browser | 35 |
| provider | 4 |
| terminal | 10 |
| filesystem | 7 |
| debug | 4 |
| service | 2 |
| security | 3 |
| workflow/harness | 13 |
| package | 5 |

### Credential Vault
Status: Implemented.

Credential vault, scope-based secret metadata, grants, provider status, audit logging, and `SecretString` redaction behavior that prevents accidental string/JSON exposure.

Known limits: browser auth snapshots are still stored plaintext according to `PROBLEMS.md`.

### Secrets Redaction
Status: Implemented.

Redaction helpers cover strings, URLs, headers, console entries, network entries, nested objects, provider tokens, credential refs, CAPTCHA keys, model keys, and Browserbase-style URLs.

### Network Rules Engine
Status: Implemented.

Allow/deny/tracker profiles, built-in tracker list, blocked-request tracking, domain/resource matching, and MCP security tools for listing network rules and blocked requests.

### Automation Packages
Status: Implemented local packages.

Local package install/list/info/update/remove/grant/run/eval, manifest validation, permission model, trust review/history, eval history, package runner, bundled TradingView ICT sample package.

This is the strategic center of the product. Every feature should support package creation, execution, repair, or evidence.

### Package Trust & Signing Primitives
Status: Partial.

Trust review and package risk/permission review exist. Hash/signature-related primitives and docs exist in places, but end-to-end package signing CLI/workflow is planned. Marketplace comes after package quality.

### Action Recorder
Status: Implemented baseline.

Recorder can capture browser/terminal/fs/API style actions into workflow/package drafts with redaction. This is strategically central — it supports the "turn successful task into package" flow. Reset cleanup fix is in current dirty worktree.

---

## P1 - CRITICAL UX

### CLI (`bc`)
Status: Implemented.

Broad CLI surface for operator and agent workflows:

- operator: `setup`, `doctor`, `status`, `config`, `data`, `benchmark`, `dashboard`, `web`, `desktop`
- browser: top-level aliases plus `browser launch|attach|detach|list|status|open|navigate|open-many|snapshot|state|act|task|capture|capture-many|cdp|dialog|provider|profile|auth`
- terminal: `term open|exec|read|write|snapshot|interrupt|resume|status|close`
- filesystem: `fs read|write|write-output|ls|move|rm|stat`
- session: `session create|list|use|status`
- daemon: `daemon start|stop|status|health|logs`
- workflow/harness/package: run/status/resume/approve/cancel/events/edit-state, helper operations, package install/list/info/update/remove/grant/run/eval/review history
- service/proxy: register/list/resolve/remove plus `.localhost` proxy, CA, startup helpers
- debug/security/knowledge/skill/memory/proxy/captcha/report/schedule surfaces
- `--json` structured output for automation

Known limits: current dirty worktree has CLI lifecycle fixes and some full release gates still pending per `PROBLEMS.md`.

### TypeScript API
Status: Implemented.

`createBrowserControl()` exposes namespaces: `browser`, `terminal`, `fs`, `session`, `service`, `provider`, `debug`, `config`, `dashboard`, `workflow`, `harness`, `package`, `benchmark`, `state`, plus status and cleanup helpers. Public exports cover browser, policy, terminal, filesystem, services, providers, workflows, packages, observability, knowledge, security, benchmarks, and trading modules.

### Web Dashboard (Experimental / Internal)
Status: Partial, hidden from production positioning.

React 19 + Vite dashboard with token-gated local auth, API client, event streaming, layout/sidebar/topbar, theme support, and pages for package/library/run history/evidence workflows plus internal advanced pages.

Default production navigation must be package-first and must not expose generic prompt-first, trading, full terminal dashboard, provider/model-router, or advanced maintenance surfaces.

Future direction: Package Library, Run Automation Package, Create Package from Successful Run, Run History, Evidence Viewer, Repair Failed Package, Permissions/Risk Review, tool-call/time/token savings.

Known limits: some dashboard changes are dirty/in-progress; terminal websocket reconnect, API timeout/abort, remaining raw JSON surfaces, and full visual verification remain open.

### Desktop App (Experimental / Internal)
Status: Partial, hidden from production positioning.

Electron 41 wrapper for the experimental dashboard with context isolation, CSP/security checks, node integration disabled, preload bridge, Windows/macOS packaging config, desktop start command, and startup error dialog work in current tree.

Known limits: desktop startup failure UX still needs more manual/visual verification. Not a stable product surface yet.

### Provider System
Status: Implemented, with provider-specific limits.

Provider registry supports local, custom CDP, Browserless, Browserbase, and unsupported remote-sandbox placeholders. Includes catalog/list/use/health, provider scoring, custom endpoint handling, local launch/attach, and Browserless/Browserbase configuration paths.

Known limits: real Browserless/Browserbase SaaS confirmation depends on credentials/endpoints; additional providers are planned.

### Browser Profiles & Auth State
Status: Implemented.

Shared/isolated/named profile handling, profile registry, migration, managed launch profile defaulting, auth export/import, stored auth snapshots, and CLI/API support.

Known limits: saved auth snapshots need encrypted-at-rest storage.

### Native JavaScript Dialog Handling
Status: Implemented backend, partial UI.

Detects `alert`, `confirm`, `prompt`, and `beforeunload` with Playwright and CDP fallback. Session-scoped registry, list/respond actions, auto-accept/auto-dismiss/must-respond modes, timeout, redaction, audit events, CLI/API/MCP tool support.

Known limits: dashboard dialog card and final product screenshots remain deferred.

### Raw CDP Passthrough
Status: Implemented with strict limits.

Trusted low-level CDP read-only passthrough with method validation, allowlist/denylist hardening, timeout/output caps, redaction, CLI/API/MCP/web route support, and tests.

Known limits: page-scoped only; `targetId`, `frameId`, and dangerous methods such as `Runtime.evaluate` are rejected.

### Network Interceptor
Status: Implemented.

Capture JSON responses, block resources, and mock responses at the browser network level. Console/network capture integrate with observability.

### Stagehand Integration
Status: Implemented optional integration.

Optional `@browserbasehq/stagehand` peer dependency with Stagehand manager/connect/disconnect helpers and tests proving optional loading behavior.

---

## P2 - PRODUCTION READINESS

### Observability & Debugging
Status: Implemented.

Debug bundles, console capture, network capture, action debug metadata, screencast recording, debug receipts, performance tracing, visual diff, recovery guidance, failure classification, debug health, bundle list/load/delete/prune, and CLI/MCP/API hooks.

### Screencast Recording
Status: Implemented.

Start/stop/status API, action timeline, receipt persistence, retention modes, screenshot/video-style evidence flow, and debug-bundle integration.

### Self-Healing Harness
Status: Implemented baseline.

Helper registry, manifest validation, helper search, validation, rollback, generation, local temp sandbox execution, CLI/API/MCP surfaces.

Known limits: no full generated helper repair loop yet; branching/advanced harness flows planned.

### Workflow Engine
Status: Implemented baseline.

Graph definitions with nodes/edges, validation, durable run store, linear execution, retries, events, status, resume, approval nodes, cancel, and state editing. CLI/API/MCP surfaces exist.

Known limits: branching/loops and visual workflow editing are planned.

### CAPTCHA Solving
Status: Implemented integration surface.

Configurable provider surface for 2captcha, Anti-Captcha, and CapSolver, with CLI test command and unit tests.

### Model Router / Local AI
Status: Partial.

Model router supports OpenRouter, Ollama, and OpenAI-compatible endpoints with config keys, local endpoint checks, fallback/cost-cap style behavior, local API server spawn helpers, and tests.

Known limits: full offline automation UX and real dashboard/provider workflows remain incomplete.

### Browser Fingerprint Evasion / Stealth
Status: Implemented opt-in primitives.

Canvas noise, WebGL vendor/renderer override, WebRTC leak prevention, `navigator.webdriver` override, plugins/mimeTypes injection, permissions override, Chrome runtime injection, DevTools suppression, iframe contentWindow patching, and tests.

### Downloads & File Upload
Status: Implemented.

Download metadata tracking/listing, single and multiple file upload, drag-drop support, and path validation.

### Services & Stable Local URLs
Status: Implemented.

Service registry, `bc://name` style resolution, local dev-server detection, `.localhost` proxy, local CA create/status/install/uninstall helpers, startup install/uninstall helpers, and CLI/API support.

### Knowledge System
Status: Implemented local backend.

Markdown artifact store, interaction/domain categories, frontmatter validation, list/find/query/search/stats helpers, local markdown backend, unsupported backend placeholders, CLI/API exports.

Known limits: vector semantic ranking and tree-index site memory are planned.

### Skill System
Status: Implemented.

Skill registry, YAML manifest parsing, validation, memory store, install/manage style CLI surfaces, and built-in Framer, Exness, and Adobe Stock skills.

### Security Hardening
Status: Partial.

Implemented: proof-of-work helpers, broker API key generation, secrets redaction, policy engine, credential vault redaction, web auth, CSP/security headers, loopback-oriented defaults, network rules, filesystem symlink hardening, dependency fixes.

Still open in `PROBLEMS.md`: broker filesystem sandbox gap, auth snapshot encryption, dashboard config allowlist, web rate limiter, content-type validation, constant-time auth compare, broker CORS default tightening.

### Install, Packaging, Release, Compatibility
Status: Implemented baseline.

NPM package metadata/bin/files, package smoke tests, build/prepack scripts, compatibility tests/snapshots, release checklist docs, cross-platform docs, WSL support script, and desktop packaging config.

---

## P3 - ADVANCED / SPECIALIZED

### Trading Features (Experimental Vertical — Not Strategic)
Status: Implemented baseline.

Trade supervisor, risk engine, position sizing, structured trade plans, order tickets, position store, trade journal, generic broker adapter, TradingView adapter, trading policy, tests, hidden dashboard page, and local TradingView ICT automation package.

**This is not a strategic product direction.** Trading/financial automation has legal, safety, and regulatory risk. Keep it package-only, high-risk, analysis-first, manual-confirmation-only, no live execution by default, disabled in production/default UI, and never use "make money" positioning.

### Scheduler
Status: Implemented.

Cron-based schedule support, scheduler runtime, daemon/broker routes, CLI schedule command, pause/resume/remove support, and tests.

Known limits: a reverted optimization is documented; cron semantics should stay conservative.

### Telemetry & Alerts
Status: Implemented basic telemetry.

Telemetry event emission and Telegram alert handler exist with tests.

### Memory Store
Status: Implemented.

Key-value memory store with SQLite persistence, stats, get/set/clear CLI surfaces, and tests.

### Proxy Manager
Status: Partial.

Proxy config loading, Playwright proxy conversion, CLI add/list/remove/test style surface, sanitization/redaction work, and tests.

Known limits: full credential-vault integration for proxy credentials is not done.

### Operator Dashboard State & Generated UI
Status: Implemented baseline.

Dashboard state collection, API/server support, generated UI schema/dispatcher module, and tests.

Known limits: full JSON-render runtime/devtools and polished generated UI product are not done.

### Health Check System
Status: Implemented.

Checks for CDP, memory store, proxy pool, CAPTCHA config, OpenRouter/model config, disk space, daemon health, provider health, and dashboard/doctor status.

### Doctor & Setup Wizard
Status: Implemented.

Runtime diagnostics, dependency/browser/CDP/PTY/data-dir/policy/MCP/session checks, and first-run setup with interactive/non-interactive paths.

### AI Agent (Non-Strategic / Support Only)
Status: Implemented minimal agent.

Autonomous agent wrapper and guardrail error plumbing exist, tied into model routing and safety concepts. Not a complete general-purpose agent product. Intentionally kept minimal — Browser Control is a workflow runtime, not an AI agent platform.

### Benchmarks & Examples
Status: Implemented baseline.

Benchmark runner/results/compare API and CLI, benchmark tests, golden examples, docs examples, e2e workflow tests, and reliability report support exist.

Known limits: standardized public benchmark suite maturity is still developing.

### Snapshot Diff by Signature
Status: Implemented baseline.

Snapshot diff and formatted summaries exist; signature/codegen-style enhancements remain future work.

---

## P4 - FUTURE / PLANNED

### High Priority Planned

| Feature | Current Status | Notes |
|---------|----------------|-------|
| Visual Workflow Editor | Planned | Runtime exists; drag-and-drop editor does not. |
| Cross-Origin Iframe Support | Planned | No full product support for embedded payment/auth/SaaS cross-origin frames. |
| Vision AI Fallback | Planned | Screenshot/canvas evidence exists; AI vision interpretation is not implemented. |
| Full Browser Terminal Polish | Partial | Terminal page exists; VT-rendered polished multiplexed terminal and reconnect behavior remain open. |
| Dashboard Dialog UI | Partial | Backend native dialog handling exists; dashboard card remains to finish. |
| Auth Snapshot Encryption | Planned | Existing auth snapshot storage is plaintext. |
| Web API Rate Limiting | Planned | Broker has buckets; web dashboard API has no general limiter. |

### Medium Priority Planned

| Feature | Current Status | Notes |
|---------|----------------|-------|
| Automation Marketplace (Strategic Future) | Planned | Comes after package quality. Near-term: package manifest clarity, creation flow, eval, trust review, examples, run history. Remote registry/selling/discovery/publishing come later. |
| Package Signing CLI | Planned | Local packages/trust review exist; end-to-end `bc package sign` workflow does not. |
| SSRF/Internal Network Protection | Planned | Network rules exist; browser navigation/outbound SSRF protection for private networks/metadata endpoints is not complete. |
| Device Emulation | Planned | Viewport config exists; full mobile presets/geolocation/offline/headers/device profiles are not implemented. |
| Playwright Trace Recording | Planned | Screencast/debug receipts exist; Playwright trace `.zip` viewer integration does not. |
| Offline Local AI Automation UX | Partial | Model router/Ollama-compatible config exists; complete offline agent workflow is not done. |
| Branching Workflow Runtime | Planned | Linear durable workflow runtime exists; branching/loops planned. |
| Helper Self-Repair Loop | Planned | Harness registry/generation/execute exists; full self-healing loop planned. |

### Lower Priority Planned

| Feature | Current Status | Notes |
|---------|----------------|-------|
| More Remote Browser Providers | Planned | Firecrawl, Browser Use cloud, E2B, CubeSandbox not implemented. |
| Package Eval Dashboard | Planned | Eval history exists; polished UI dashboard missing. |
| Hybrid Cloud/Local Routing | Planned | Provider system exists; automatic route-by-URL privacy is not done. |
| Anti-Detect Browser Runtimes | Planned | Stealth primitives exist; Camofox/Cloak/Obscura runtime support is not implemented. |
| Vector Knowledge Backend | Planned | Local markdown backend exists. |
| Tree-Index Site Memory | Planned | Knowledge system exists; site memory index does not. |
| Background Visible-Browser Focus Respect | Planned | Current visible Chrome can refocus after user minimizes it. |

### Long-Term / Out Of Current Scope

| Feature |
|---------|
| Full native desktop GUI automation outside Chromium |
| Photoshop / Illustrator native desktop control |
| General OS mouse/keyboard automation for non-browser apps |
| ACP (Agent Communication Protocol) integration |
| IDE-specific companion products |
| Cloud/team mode |
| Voice operator feedback (TTS) |

---

## NEW DEVELOPMENT ROADMAP

### Phase 1 — Direction Reset

Files to create/update:
- `PRODUCT_DIRECTION.md`
- `INSTRUCTIONS.md` or `AGENT_INSTRUCTIONS.md`
- `FEATURES.md`
- `README.md`

Goal: Every AI agent understands Browser Control is package-first, not Codex-like.

### Phase 2 — Package-First MVP

Implement or harden:
- create package from successful run
- run package with saved steps
- count tool calls per run
- compare first run vs replay run
- save screenshots/evidence
- simple package manifest
- repair failed selector/helper
- package eval command

### Phase 3 — One Niche Proof

Pick one niche:
- Web app QA automation, or
- CRM/admin reporting automation

Build 2–3 package examples only.

### Phase 4 — UI Pivot

Future experimental dashboard becomes:
- package library
- run history
- evidence viewer
- repair queue
- package permissions
- savings metrics

Not generic chat.

### Phase 5 — Business Validation

Offer: "I turn your repeated browser workflow into a Browser Control Automation Package."

This is custom automation service, not SaaS.

---

## VERIFIED CURRENT SURFACES

### MCP Full Tool Names

Current full MCP tool count: 88. Lite count: 14.

Browser tools: `bc_browser_open`, `bc_browser_open_many`, `bc_browser_navigate`, `bc_browser_capture`, `bc_browser_capture_many`, `bc_browser_snapshot`, `bc_browser_click`, `bc_browser_fill`, `bc_browser_fill_many`, `bc_browser_hover`, `bc_browser_type`, `bc_browser_paste`, `bc_browser_press`, `bc_browser_scroll`, `bc_browser_screenshot`, `bc_browser_highlight`, `bc_browser_generate_locator`, `bc_browser_tab_list`, `bc_browser_tab_switch`, `bc_browser_tab_close`, `bc_browser_close`, `bc_browser_screencast_start`, `bc_browser_screencast_stop`, `bc_browser_screencast_status`, `bc_browser_list`, `bc_browser_attach`, `bc_browser_detach`, `bc_browser_launch`, `bc_browser_drop`, `bc_browser_downloads_list`, `bc_browser_dialog`, `bc_browser_cdp`, `bc_browser_state`, `bc_browser_act`, `bc_task_run`.

Other tools: `bc_status`, `bc_session_create`, `bc_session_list`, `bc_session_select`, `bc_session_status`, `bc_browser_provider_list`, `bc_browser_provider_catalog`, `bc_browser_provider_use`, `bc_browser_provider_health`, `bc_terminal_open`, `bc_terminal_exec`, `bc_terminal_read`, `bc_terminal_write`, `bc_terminal_interrupt`, `bc_terminal_snapshot`, `bc_terminal_list`, `bc_terminal_close`, `bc_terminal_resume`, `bc_terminal_status`, `bc_fs_read`, `bc_fs_write`, `bc_fs_write_output`, `bc_fs_list`, `bc_fs_move`, `bc_fs_delete`, `bc_fs_stat`, `bc_debug_health`, `bc_debug_failure_bundle`, `bc_debug_get_console`, `bc_debug_get_network`, `bc_service_list`, `bc_service_resolve`, `bc_vault_list`, `bc_network_rules_list`, `bc_network_blocked_requests`, `bc_workflow_run`, `bc_workflow_status`, `bc_workflow_resume`, `bc_workflow_approve`, `bc_workflow_cancel`, `bc_workflow_events`, `bc_workflow_edit_state`, `bc_harness_list`, `bc_harness_find_helper`, `bc_harness_validate_helper`, `bc_harness_rollback`, `bc_harness_generate`, `bc_harness_execute`, `bc_package_list`, `bc_package_info`, `bc_package_run`, `bc_package_grant`, `bc_package_eval`.

### TypeScript API Namespaces

`browser`, `terminal`, `fs`, `session`, `service`, `provider`, `debug`, `config`, `dashboard`, `workflow`, `harness`, `package`, `benchmark`, `state`, `status`, `close`.

### Config Keys

Audited config key count: 33.

Keys: `dataHome`, `brokerPort`, `chromeDebugPort`, `chromeBindAddress`, `chromePath`, `browserDebugUrl`, `browserMode`, `browserAutoLaunch`, `browserLaunchProfile`, `browserUserDataDir`, `browserViewportWidth`, `browserViewportHeight`, `browserUserAgent`, `policyProfile`, `daemonVisible`, `logLevel`, `logFile`, `terminalShell`, `terminalCols`, `terminalRows`, `terminalResumePolicy`, `terminalAutoResume`, `browserlessEndpoint`, `browserlessApiKey`, `captchaProvider`, `captchaApiKey`, `modelProvider`, `modelEndpoint`, `modelApiKey`, `modelName`, `openrouterModel`, `openrouterBaseUrl`, `openrouterApiKey`.
