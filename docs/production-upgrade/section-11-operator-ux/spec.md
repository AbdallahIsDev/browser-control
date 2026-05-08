# Section 11: Operator UX

## Purpose
Even a powerful engine feels unfinished if install, config, sessions, and diagnostics are confusing. This section delivers the operator-facing commands and flows that make Browser Control feel like a real product: doctor, setup, config, status, and clean documentation.

## Why This Section Matters to Browser Control
The engine is strong. The features are there. But if a new user can't figure out how to install, configure, and run their first automation in 5 minutes, they leave. Operator UX is the packaging around the power — it's what makes the product accessible.

## Scope
- `bc doctor` — runtime dependency and health check
- `bc setup` — guided first-time configuration
- `bc config` — view and modify settings
- `bc status` — current system state
- Documentation cleanup: clear separation of core runtime, agent usage, browser usage, terminal usage, skill system, operator commands, examples
- Package identity cleanup (clean repo structure for public consumption)

## Non-Goals
- Do not build a GUI dashboard for v1
- Do not create wizard-only setup with no scriptable alternative
- Do not hide important state in undocumented files
- Do not require interactive prompts for every configuration change

## User-Facing Behavior

### `bc doctor`
Checks and reports on:
- Runtime dependencies (Node.js version, Chrome availability)
- CDP attachability (can we connect to Chrome?)
- Terminal backend availability (is PTY supported?)
- Writable data directories
- Policy config validity
- MCP server readiness
- Session store integrity
- Proxy configuration (if proxies are configured)
- CAPTCHA provider (if configured)
- AI agent key (if configured)

Output: pass/fail per check with actionable fix suggestions for failures.

### `bc setup`
Guides through:
- Install path verification
- Data directory creation
- Browser mode selection (managed vs attach)
- Automation profile creation
- Shell support detection
- Default policy profile selection
- Optional MCP setup (generate config snippet for the user's agent)
- Optional browser attach test
- Optional terminal execution test

Can be run interactively or non-interactively (`bc setup --non-interactive --profile balanced`).

### `bc config`
Exposes:
- Browser settings (debug port, bind address, user agent)
- Terminal settings (default shell, working directory)
- Policy defaults (default profile, custom rules path)
- Session defaults (auto-create, persistence)
- Logs/telemetry settings (log level, log file)
- MCP settings (server port, transport)

Supports: `bc config get <key>`, `bc config set <key> <value>`, `bc config list`.

### `bc status`
Shows:
- Active browser sessions (count, connection mode, profile)
- Active terminal sessions (count, shell type, state)
- Queued/running tasks
- Daemon state (running/stopped/degraded)
- Health summary (one-line per component)
- Current policy profile
- Data directory path

### Docs Structure
The repo must clearly separate:
- `docs/getting-started.md` — install, setup, first automation
- `docs/browser.md` — browser usage, profiles, stealth
- `docs/terminal.md` — terminal sessions, execution modes
- `docs/skills.md` — skill development, packaging, knowledge
- `docs/mcp.md` — MCP setup for each agent ecosystem
- `docs/policy.md` — policy profiles, risk levels, custom rules
- `docs/api.md` — TypeScript API reference
- `docs/cli.md` — full CLI reference
- `docs/troubleshooting.md` — common issues and fixes

## Agent-Facing Behavior
- Agent can call `bc doctor` to verify environment before starting work
- Agent can read `bc status` output to understand current state
- Agent doesn't use `bc setup` (that's human-facing) but benefits from the clean config it produces

## Architecture/Design

### Doctor Implementation
Each check is a function returning `{ name, passed, details?, fix? }`. `bc doctor` runs all checks and formats the output. Critical checks (Chrome, data dir) block non-critical ones (MCP, CAPTCHA) from running if they fail.

### Setup Implementation
`bc setup` is a state machine: collect input → validate → apply → verify. Each step can run interactively (prompt user) or non-interactive (use flags/defaults). The setup writes to Browser Control's user-scoped config home and data directory. Repository-local `.env` support remains a development-mode compatibility path, not the primary production storage model.

### Config Implementation
Config is backed by the existing `config.ts` module, but the production-facing source of truth should be a user-scoped config file under Browser Control's home/config directory. `bc config get/set` reads and writes that user-scoped config. Environment variables and repo-local `.env` files remain supported as overrides/compatibility inputs where appropriate. `bc config list` shows effective values, their defaults, and their source.

## Core Components/Modules
- `cli/doctor.ts` — health check runner, output formatting
- `cli/setup.ts` — interactive/non-interactive setup flow
- `cli/config.ts` — config get/set/list commands
- `cli/status.ts` — system state aggregation and display
- `docs/` — documentation restructure

## Data Models/Interfaces
```typescript
interface DoctorCheck {
  name: string;
  passed: boolean;
  details?: string;
  fix?: string; // actionable fix suggestion
}

interface SystemStatus {
  browser: {
    sessions: number;
    connectionMode: string;
    profile: string;
    healthy: boolean;
  };
  terminal: {
    sessions: number;
    shells: string[];
    healthy: boolean;
  };
  tasks: {
    queued: number;
    running: number;
  };
  daemon: "running" | "stopped" | "degraded";
  policyProfile: string;
  dataDir: string;
}
```

## Session/State Implications
- `bc doctor` and `bc status` are read-only — they don't modify state
- `bc setup` creates initial state (data dir, user-scoped config, profiles)
- `bc config set` modifies the user-scoped config store — changes take effect on next process start unless a setting explicitly supports reload
- Status output reflects real-time state by querying running processes and data store

## Permissions/Guardrails Implications
- `bc doctor` is `low` risk (read-only checks)
- `bc setup` is `moderate` risk (writes config files, creates directories)
- `bc config set` is `moderate` risk (modifies configuration)
- All setup/config operations should be auditable

## Failure/Recovery Behavior
- If `bc doctor` finds critical failures, it exits with code 1 and shows fix suggestions
- If `bc setup` fails midway, it reports what succeeded and what failed — user can re-run
- If `bc config set` receives an invalid value, it rejects the change with a clear error
- If `bc status` can't reach the daemon, it reports daemon as "stopped" (not an error)

## CLI/API/MCP Implications
- `bc doctor` — CLI only (human-facing)
- `bc setup` — CLI only (human-facing)
- `bc config get/set/list` — CLI, with API equivalents for programmatic access
- `bc status` — CLI, with MCP tool `bc_status` for agent access
- No MCP tools for doctor/setup (those are human-facing)

## Browser/Terminal/FileSystem Path Implications
- Doctor checks all paths (browser CDP, terminal PTY, filesystem writable)
- Status aggregates state from all paths
- Setup configures defaults for all paths
- Config exposes settings for all paths

## Dependencies on Other Sections
- **Depends on:** All other sections — this section provides the UX around them
- **Depended by:** New users — this is the entry point

## Risks/Tradeoffs
- **Risk:** Setup becomes too complex. Mitigation: sane defaults, non-interactive mode, skip optional steps.
- **Risk:** Doctor gives false positives. Mitigation: each check is independently testable, fix suggestions are verified.
- **Tradeoff:** CLI-only for v1 (no GUI). Accepted — GUI is post-v1, CLI is sufficient for the target audience.

## Open Questions
- Should `bc setup` be mandatory on first run or optional? Recommendation: optional but recommended — auto-run if no Browser Control user config exists and user runs `bc` with no arguments.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Study and adapt proven operator UX patterns.**

Operator UX — doctor, setup, config, status — has been done well by several upstream projects. No need to invent these patterns from scratch.

**Upstream sources:**
- **browser-use** (Python) — setup flow, doctor checks, configuration UX, session management ergonomics.

**What to reuse:**
- Doctor check patterns (what to check, how to report, how to suggest fixes)
- Setup flow structure (guided config, non-interactive mode, optional steps)
- Config get/set/list patterns
- Status aggregation patterns (what to show, how to format)

**What NOT to reuse:**
- Do not import Python implementation — adapt the UX patterns into TypeScript CLI
- Do not assume upstream config format — Browser Control uses .env + typed config.ts
- Do not assume single-surface status — Browser Control status must aggregate browser + terminal + daemon + policy

**Mixed-language note:** browser-use is Python. Study its UX flow and check patterns, implement in Browser Control's TypeScript CLI.

## Implementation Success Criteria
- A new user can install, run `bc setup`, and complete their first automation in under 5 minutes
- `bc doctor` correctly identifies all common failure modes
- Documentation is clear enough that an AI agent can guide a human through setup
- The repo feels product-ready (clean structure, clear README, no internal artifacts exposed)
- `bc status` gives a complete picture of system state in one command
