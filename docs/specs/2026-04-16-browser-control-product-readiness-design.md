# Browser Control — Product Readiness Design

## Overview

Transform "browser-automation-core" into "Browser Control" — a cross-platform, production-ready AI browser automation platform. The project is currently a working framework (~12K lines, 181 passing tests) but has hardcoded Windows paths, no build step, no install story, and several architectural gaps that prevent it from running reliably as an autonomous system.

This design covers four areas: rename + cross-platform foundation, core engine hardening, skill system upgrades, and build/install/packaging.

## Requirements

1. Rename project to "browser-control" with CLI binary `bc`
2. Remove all hardcoded Windows paths — run on any OS
3. Daemon must survive Chrome disconnections and reconnect automatically
4. Tasks must persist state across daemon restarts (not just timeout on shutdown)
5. Skills must support state save/restore for long-running autonomous workflows
6. Project must be buildable to compiled JS and installable via npm
7. Configuration must be centralized and validated at startup

## Approach

### Section 1: Rename + Cross-Platform

**Rename scope:**
- Directory: `browser-automation-core/` → `browser-control/`
- package.json name: `"browser-control"`
- CLI binary: `bc` (was `bac`)
- Import prefix: `@bc/*` (was `@bac/*`)
- All references in README, docs, comments

**Cross-platform launcher:**
- Create `scripts/launch_browser.ts` — Node.js launcher that detects OS, finds Chrome, handles debug port binding
- `launch_browser.bat` and `launch_browser.ps1` become thin wrappers
- Create `launch_browser.sh` for Linux/macOS
- WSL↔Windows bridge logic only activates on `process.platform === 'win32'` with WSL detected
- On Linux/macOS: bind to `127.0.0.1` directly, no bridge needed

**Dynamic paths:**
- Data directory: `~/.browser-control/` (override with `BROWSER_CONTROL_HOME`)
- Contains: `memory.sqlite`, `reports/`, `logs/`, `.interop/`, `skills/`
- Created automatically on first run
- Replace `C:\Users\11\` references with `os.homedir()` / `process.env.HOME` / `process.env.USERPROFILE`

**Cleanup:**
- Populate or remove empty `project-template/` directory
- Fix root-level `framer_skill.ts` stub (6 lines importing from `./skills/framer_skill`)

### Section 2: Core Engine Hardening

**Graceful shutdown (revised for long-running tasks):**
- On SIGTERM/SIGINT/SIGHUP: stop accepting new tasks immediately
- Do NOT wait for running tasks to finish (they can run for hours)
- Persist each running task's state to memory store: `{ taskId, skill, action, params, step, status: 'running', startedAt }`
- Stop cleanly (close broker, save telemetry, write shutdown record)
- On restart: detect persisted "running" tasks (were interrupted)
- Resume policy per task: `resume` (pick up where left off), `reschedule` (queue for next tick), `abandon` (mark as interrupted)

**Chrome reconnection watchdog:**
- Check CDP endpoint health every 30 seconds
- On disconnect: attempt reconnection using last known `.interop/chrome-debug.json`
- After N failed attempts (default 3): emit critical alert, pause all scheduled tasks
- When Chrome returns: resume automatically
- Expose status: `running | degraded (chrome disconnected) | stopped`

**Task retry with backoff:**
- Per-step retry config: `retries`, `retryDelayMs`, `retryBackoff` (linear/exponential)
- Default: 2 retries, 1s initial, exponential
- Steps can set `continueOnFailure: true` to proceed despite failure
- Scheduler retries failed tasks on next tick instead of silently dropping

**Structured logging:**
- Simple `Logger` class (~50 lines), no third-party deps
- Levels: `debug`, `info`, `warn`, `error`, `critical`
- Configurable via `LOG_LEVEL` env var (default: `info`)
- Writes to stdout + optional file in data directory
- Each line: timestamp, level, component, message, optional structured data

**Resource monitoring:**
- Track memory usage, Chrome tab count, active tasks, queue depth
- Enrich `GET /api/v1/stats`
- Alert on memory threshold (default 1GB) and tab count limit (default 20)

### Section 3: Skill System

**State persistence per skill:**
- Add optional `saveState()` and `restoreState()` to `Skill` interface
- Daemon calls `saveState()` periodically (default 60s) and on shutdown
- On restart, calls `restoreState()` before `setup()`
- State stored in memory store under `skill:{name}:state`
- Backward compatible — skills without these methods work as before

**Extended lifecycle hooks:**
- `onPause(context)` — daemon shutting down, save progress
- `onResume(context)` — daemon restarted, continue from saved state
- `onError(context, error)` — action threw, skill decides: retry/skip/escalate
- All optional — no breaking changes

**Typed action system:**
- Add `actions` field to `SkillManifest` with param schemas
- Enables `bc skill actions <name>` to list available actions
- AI agent can inspect actions before calling

**Skill isolation:**
- Scoped memory namespace: `skill:{name}:` prefix on all keys (transparent to skill)
- Multi-session: each skill gets its own page reference via `StagehandManager`

**Skill packaging (design only, not implementation):**
- Skill package format: `skill.yaml` (manifest), `index.ts` (implementation), `README.md`, `config.schema.json`
- `skill.yaml` is source of truth for name, version, actions, required env vars, allowed domains
- `bc skill install ./my-skill/` for local install
- Future: registry URL for marketplace

**Skill validation:**
- Validate manifest against schema on daemon load
- Missing required fields or invalid param types → warning + skip, don't crash
- `bc skill validate <name>` command

### Section 4: Build + Install + Packaging

**Build step:**
- `tsconfig.build.json` extending `tsconfig.json`, excluding `*.test.ts`, `docs/`, `screenshots/`, `project-template/`
- `npm run build` → `dist/`
- `bin.bc` points to `dist/cli.js`
- `main` and `types` point to `dist/index.js` and `dist/index.d.ts`

**Configuration system:**
- `config.ts` module: loads all env vars, validates required ones, provides defaults
- Single `Config` export used everywhere instead of scattered `process.env` reads
- `.env.example` with every env var documented
- Fail-fast on missing required config at startup

**npm packaging:**
- Remove `"private": true`
- Add `"files": ["dist/", "README.md", "LICENSE"]`
- `"prepublishOnly": "npm run build"`

## Components

| Component | File(s) | What Changes |
|-----------|---------|-------------|
| CLI | `cli.ts`, `cli.js` | Rename binary to `bc`, update imports to `@bc/*` |
| Config | NEW `config.ts` | Centralized env var loading + validation |
| Logger | NEW `logger.ts` | Structured logging with levels |
| Daemon | `daemon.ts` | Graceful shutdown (persist + resume), Chrome watchdog, skill state hooks |
| Broker | `broker_server.ts` | Enriched stats, no structural changes |
| Skill Interface | `skill.ts` | Add `saveState`, `restoreState`, `onPause`, `onResume`, `onError`, `actions` |
| Skill Registry | `skill_registry.ts` | Manifest validation, scoped memory |
| Launcher | NEW `scripts/launch_browser.ts` | Cross-platform Chrome launcher |
| Task Engine | `task_engine.ts` | Retry with backoff, `continueOnFailure` |
| Build | `tsconfig.build.json` | Build config excluding tests |
| Package | `package.json` | Rename, bin, files, scripts |

## Open Questions

1. Should `bc skill install` support remote URLs in v1, or local-only?
2. Should the Chrome watchdog be part of the daemon or a separate process?
3. Should `config.ts` support config files (e.g., `browser-control.config.ts`) in addition to env vars?
4. How should skill state serialization handle large data (e.g., cached DOM snapshots)?
