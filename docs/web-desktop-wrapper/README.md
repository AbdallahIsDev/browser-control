# Web and Desktop Wrapper

## Overview

This feature adds two operator-facing shells around the existing Browser Control runtime:

- a local web application for browser-based operation
- a Windows desktop application that reuses the web UI and connects to the same local runtime bridge

The wrappers do not replace the CLI, MCP server, TypeScript API, daemon, broker, task engine, scheduler, browser actions, terminal actions, filesystem actions, policy engine, or observability layer. They provide a dashboard over those systems.

## Web Wrapper

The web wrapper is a localhost-only operator dashboard. It must expose:

- runtime, daemon, broker, MCP, and health status
- browser sessions, URL open, snapshots, screenshots, refs, debug evidence
- task creation, execution, status, history, and events
- automation/scheduler list, create, pause, resume, run-now where supported, and delete
- terminal sessions, command execution, streaming output, input, resize where supported, and stop
- filesystem read/list/write/move/delete where policy allows
- live logs, audit events, policy decisions, redacted debug evidence
- configuration, runtime paths, provider state, policy profile, and doctor checks

## Windows Desktop Wrapper

The Windows wrapper should use the same UI codebase as the web app. Electron is the initial recommendation because this project is Node/TypeScript, depends on Node APIs, uses `node-pty`, has a long-running daemon/broker process, and needs simple Windows process ownership.

Desktop behavior:

- launch as a Windows app
- start or connect to the local app server
- bind privileged API server to `127.0.0.1` by default
- pass an app-local auth token to the renderer
- keep `contextIsolation: true`, `nodeIntegration: false`
- block arbitrary navigation
- cleanly stop child app-server process on exit unless user chooses persistent daemon

## Shared Backend Runtime Integration

Runtime integration must flow through existing modules:

```text
UI shell -> local app server bridge -> createBrowserControl()/daemon/broker/runtime modules
```

The bridge must reuse:

- `createBrowserControl()` for browser, terminal, filesystem, service, provider, config, debug, dashboard, workflow, harness, and package namespaces
- `SessionManager` for session and policy context
- `DefaultPolicyEngine` and `defaultRouter` for policy checks
- `BrokerServer` patterns for auth, local binding, rate limits, body limits, and WebSocket events
- `TaskEngine` and `Scheduler` through daemon/broker callbacks where available
- `TerminalActions` and daemon-backed `TerminalRuntime` for terminal sessions
- `FsActions` for structured filesystem operations
- `BrowserActions` for browser automation, snapshots, screenshots, observability, and downloads
- `operator/status`, `operator/doctor`, and `operator/dashboard` for operator state
- `observability/debug_bundle`, console/network capture, redaction, screencast receipts, and action debug metadata

## Discovered Architecture

Current repo is a Node.js/TypeScript package with:

- public API facade: `src/browser_control.ts`
- CLI: `src/cli.ts`
- long-running daemon: `src/runtime/daemon.ts`
- HTTP/WebSocket broker: `src/runtime/broker_server.ts`
- typed result contract: `src/shared/action_result.ts`
- policy system: `src/policy/*`
- browser automation: `src/browser/*`, `src/a11y_snapshot.ts`, `src/ref_store.ts`
- terminal automation: `src/terminal/*`
- filesystem actions: `src/filesystem/*`
- operator state/doctor/setup: `src/operator/*`
- MCP tool surface: `src/mcp/*`
- observability/debug evidence: `src/observability/*`

Root compatibility wrappers and `src/*` compatibility wrappers preserve historical import paths. New production logic belongs under `src/` and new UI packages under `web/` and `desktop/` or `apps/*`.

## Changes Planned

Add:

- `src/web/` app-server bridge and typed contracts
- `web/` Vite/React operator UI
- `desktop/` Electron Windows shell reusing built web UI
- CLI commands for `bc web`, `bc web serve`, `bc web open`, and `bc desktop`
- focused tests for app-server routes, security, event schemas, terminal bridge, and desktop security config

Update:

- `package.json` scripts and dependencies only as needed
- `src/cli.ts` command routing
- docs and review checklist

## Not Changed

Do not:

- replace Browser Control runtime architecture
- bypass policy checks
- shell out to CLI for every action when TypeScript API exists
- break CLI/MCP/API compatibility
- expose raw Node APIs to desktop renderer
- ship mock-only dashboard behavior
- expose secrets or unredacted config/log/debug data to frontend
