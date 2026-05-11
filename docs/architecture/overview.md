# Architecture Overview

## System Architecture

Browser Control is a **local automation engine** with five execution surfaces and three domain paths, all governed by a centralized policy engine.

```
┌──────────────────────────────────────────────────────────┐
│                    Execution Surfaces                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────┐  ┌────┐ │
│  │   CLI   │  │  TS API │  │   MCP   │  │ Web │  │Desktop│ │
│  │ bc ...  │  │createBC │  │ stdio   │  │Dash │  │Electron│ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └──┬──┘  └──┬──┘ │
│       │            │            │          │         │     │
│       └────────────┴────────────┴──────────┴─────────┘     │
│                          │                                 │
│              ┌───────────┴───────────┐                     │
│              │    Policy Engine      │                     │
│              │   (safe/balanced/     │                     │
│              │    trusted)           │                     │
│              └───────────┬───────────┘                     │
│                          │                                 │
│       ┌──────────────────┼──────────────────┐              │
│       ▼                  ▼                  ▼              │
│  ┌─────────┐       ┌─────────┐       ┌──────────┐         │
│  │ command │       │  a11y   │       │ low_level│         │
│  │  path   │       │  path   │       │   path   │         │
│  └────┬────┘       └────┬────┘       └────┬─────┘         │
│       │                 │                 │                │
│  ┌────┴────┐       ┌────┴────┐       ┌────┴─────┐         │
│  │Terminal │       │Browser  │       │CDP/DOM/  │         │
│  │Filesyst │       │Snapshot │       │Network   │         │
│  │Services │       │Refs @e3 │       │Fallback  │         │
│  │Process  │       │         │       │          │         │
│  └─────────┘       └─────────┘       └──────────┘         │
│                                                           │
│                    ┌─────────────┐                        │
│                    │  ActionResult │  ← Every action       │
│                    │  { success,   │    returns this      │
│                    │    path,      │                      │
│                    │    policy,    │                      │
│                    │    debug }    │                      │
│                    └─────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

## Execution Surfaces

### 1. CLI (`bc`)

The primary human operator surface. 100+ subcommands for setup, status, sessions, browser, terminal, filesystem, debug, and configuration. Implemented in `src/cli.ts`.

### 2. TypeScript API

Programmatic interface for embedding Browser Control in Node.js applications. Exposed via `createBrowserControl()` in `src/browser_control.ts`. Returns a namespaced object with `browser`, `terminal`, `fs`, `session`, `service`, `provider`, `debug`, and `config` namespaces.

### 3. MCP Server

Model Context Protocol stdio server for AI agent integration. Exposes 66 tools across 10 categories. Implemented in `src/mcp/server.ts` with tools registered in `src/mcp/tools/`.

### 4. Web Dashboard

React 19 + Vite frontend served by a loopback-only Express server. Provides visual browser session management, terminal, and debugging. Frontend in `web/`, backend in `src/web/server.ts`.

### 5. Desktop App

Electron wrapper that spawns the web server and loads the dashboard in a native window. Implemented in `desktop/main.cjs`, `desktop/preload.cjs`, and `desktop/security.cjs`.

## Execution Paths

Every action is routed through one of three paths based on the action type and policy evaluation:

| Path | Domain | Risk | Capabilities |
|------|--------|------|-------------|
| **command** | Terminal, FS, services, processes | Medium-High | Shell execution, file I/O, service registry, process management |
| **a11y** | Browser accessibility | Low-Medium | Page snapshots with stable refs, click/fill/type on semantic elements |
| **low_level** | CDP, DOM, network | High | Raw browser control, network interception, script injection |

## Policy Engine

The policy engine (`src/policy/engine.ts`) evaluates every action against the configured profile before routing it to the appropriate execution path.

Three built-in profiles:

- **`safe`**: Denies high-risk and critical-risk actions. Suitable for untrusted agents.
- **`balanced`** (default): Requires confirmation for high and critical risk actions. Suitable for supervised agents.
- **`trusted`**: Audits high-risk actions, requires confirmation only for critical risks. Suitable for trusted local workflows.

The execution router (`src/policy/execution_router.ts`) maps action steps to the appropriate path based on policy evaluation.

## Key Subsystems

### Browser Automation (`src/browser/`)

Uses Playwright to control Chromium via CDP. Key components:

- **`actions.ts`**: All browser operations (open, click, fill, screenshot, etc.)
- **`connection.ts`**: CDP connection management, launch, attach, detach
- **`profiles.ts`**: Browser profile and auth state management
- **`a11y_snapshot.ts`**: Accessibility tree parsing with stable ref generation
- **`ref_store.ts`**: Ref resolution — finds elements by `@e3` notation
- **`stagehand_core.ts`**: Optional Stagehand integration for AI-driven actions

### Terminal Automation (`src/terminal/`)

Uses `node-pty` for cross-platform PTY sessions. Key components:

- **`session.ts`**: Persistent terminal session lifecycle
- **`actions.ts`**: Open, exec, read, write, interrupt, close operations
- **`prompt.ts`**: Shell prompt detection
- **`snapshot.ts`**: Buffer and cursor state capture
- **`resume.ts`**: Session resume from persisted state
- **`serialize.ts`**: State serialization for persistence

### Filesystem (`src/filesystem/`)

Structured, policy-governed filesystem operations. Not shell emulation — uses Node.js `fs` module directly with policy gating.

### Provider System (`src/providers/`)

Browser provider abstraction for targeting different browser backends:

- **`local`**: Default — controls a local Chromium/CDP instance
- **`custom`**: Arbitrary CDP endpoint (remote Chrome, Docker, etc.)
- **`browserless`**: Browserless.io cloud browser service

### Service Registry (`src/services/`)

Stable local service URLs using `bc://service-name` references. Services are registered, resolved, and discovered at runtime.

### Workflow Runtime (`src/workflows/`)

Linear workflow graph execution engine. Workflows are JSON graphs with steps, conditions, and policy gates. Supports run, status, resume, approve, and cancel lifecycle.

### Self-Healing Harness (`src/harness/`)

Helper registry for repeat failure recovery. Helpers are domain-specific recovery scripts registered by site/task/failure type. Supports list, find, validate, and rollback operations.

### Automation Packages (`src/packages/`)

Installable automation packages with permission manifests, workflow runners, and eval proof. Example: `automation-packages/tradingview-ict-analysis/`.

### Observability (`src/observability/`)

Debug infrastructure for failure analysis:

- **Debug bundles**: Snapshot-based evidence collection on failure
- **Console capture**: Browser console log interception
- **Network capture**: Browser network request/response recording
- **Performance tracing**: Action timing and profiling
- **Redaction**: Sensitive data scrubbing from debug output

### Runtime (`src/runtime/`)

Long-running infrastructure:

- **Daemon**: Persistent daemon process for terminal session management
- **Broker**: HTTP broker for daemon communication
- **Health check**: System diagnostics and readiness probes
- **Memory store**: SQLite-backed state persistence
- **Task engine**: Scheduled and recurring task execution

## Data Flow

```
Action Request (CLI/API/MCP/Web)
        │
        ▼
┌──────────────────┐
│   Policy Engine   │  ← Evaluate risk against profile
└────────┬─────────┘
         │
    ┌────┴────┐
    │ Allowed? │
    └────┬────┘
     Yes │         No ──→ Denied ActionResult
         ▼
┌──────────────────┐
│ Execution Router  │  ← Route to command/a11y/low_level
└────────┬─────────┘
         │
    ┌────┼────┬────────┐
    ▼    ▼    ▼        ▼
 Command A11y Low   (Provider
  Path  Path Level   Adapt)
         │
         ▼
┌──────────────────┐
│    ActionResult  │  ← { success, path, sessionId, policy, ... }
└──────────────────┘
```

## State & Persistence

Runtime data lives under `~/.browser-control/` (or `%USERPROFILE%\.browser-control`):

- **SQLite databases**: Session state, terminal buffers, config, provider registry, helper registry, package registry, knowledge artifacts
- **Screenshots**: Saved action screenshots
- **Screencasts**: Browser recording videos
- **Debug bundles**: Failure evidence archives
- **Logs**: Daemon and action logs

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js ≥22 |
| Language | TypeScript (strict) |
| Browser | Playwright + Chromium/CDP |
| Terminal | node-pty (native PTY) |
| Storage | SQLite (Node.js built-in `node:sqlite`) |
| MCP | @modelcontextprotocol/sdk v1.29 |
| Frontend | React 19, Vite 8 |
| Desktop | Electron 41 |
| Validation | Zod |
| WebSocket | ws v8 |
| Formatting | Biome |
| CI/CD | GitHub Actions (Windows/Linux/macOS) |

## Related Docs

- [Source Layout](source-layout.md) — Directory structure and import conventions
- [Browser Behavior](../browser.md) — Browser modes, profiles, and remote providers
- [Terminal & Filesystem](../terminal.md) — Terminal sessions and FS operations
- [Security Model](../security.md) — Trust boundaries and policy details
- [Configuration](../configuration.md) — Config keys, env vars, runtime paths
- [MCP Setup & Tools](../mcp.md) — MCP server configuration and tool reference
- [Compatibility](../compatibility.md) — Semver policy and breaking changes
