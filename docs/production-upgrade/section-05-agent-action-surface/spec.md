# Section 5: Agent Action Surface

## Purpose
Browser Control needs a direct, composable action surface that an agent or human can use immediately — not buried behind skills, daemon setup, or internal APIs. This section makes Browser Control feel like a tool, not a framework.

## Why This Section Matters to Browser Control
The internal architecture is stronger than the user-facing surface. An agent wants: short command, deterministic output, composable actions, persistent sessions, machine-readable results. This section delivers that across browser, terminal, and filesystem operations through a unified CLI, MCP, and TypeScript API.

## Scope
- Direct CLI commands for browser, terminal, filesystem, and session operations
- TypeScript API mirroring the CLI
- Structured output contracts for all actions
- Session model that binds browser + terminal + filesystem + policy + audit
- Consistent interface across CLI, MCP, and programmatic API

## Non-Goals
- Do not bury direct browser actions behind only "skills"
- Do not force all users through daemon/task scheduling for simple use
- Do not create separate tools with separate mental models for browser vs terminal vs filesystem

## User-Facing Behavior
A human can type `bc open https://example.com`, get a snapshot, click a ref, fill a field, run a shell command, read a file — all without reading internal code or manually managing daemon internals.

## Agent-Facing Behavior
An agent receives a page snapshot, proposes `click @e3`, gets back a structured `ActionResult` with success/failure/path/sessionId/auditId. It can chain actions deterministically. Sessions persist across invocations.

## Architecture/Design

### CLI Shape
The CLI has subcommands by surface:

**Browser:** `bc open <url>`, `bc snapshot`, `bc click <ref>`, `bc fill <ref> <text>`, `bc type <text>`, `bc hover <ref>`, `bc press <key>`, `bc scroll down`, `bc screenshot`, `bc tab list`, `bc tab switch <id>`, `bc close`

**Terminal:** `bc term open`, `bc term exec "<cmd>"`, `bc term type "<text>"`, `bc term snapshot`, `bc term read`, `bc term interrupt`, `bc term close`

**Filesystem/System:** `bc fs ls <path>`, `bc fs read <path>`, `bc fs write <path>`, `bc fs move <src> <dst>`, `bc fs rm <path>`, `bc sys process list`, `bc sys service status <name>`

**Sessions:** `bc session list`, `bc session create <name>`, `bc session use <name>`, `bc session status`

**Common flags:** `--json`, `--session <name>`, `--profile <policy-profile>`, `--confirm`, `--headed`

### Canonical CLI Grammar
- Top-level browser actions are canonical: `bc open`, `bc snapshot`, `bc click`, `bc fill`, `bc screenshot`
- `bc browser ...` is reserved for browser lifecycle and identity management: attach, launch, profiles, auth state
- Terminal operations live under `bc term ...`
- File and system operations live under `bc fs ...` and `bc sys ...`
- If aliases are added for ergonomics, the top-level grammar remains the documented source of truth for browser actions

### API Shape
```typescript
const bc = createBrowserControl();
await bc.browser.open("https://example.com");
const snap = await bc.browser.snapshot();
await bc.browser.click("@e3");
const shell = await bc.terminal.open();
await shell.exec("ls -la");
await bc.fs.write("/tmp/test.txt", "hello");
```

### Output Contracts
```typescript
interface ActionResult<T = unknown> {
  success: boolean;
  path: "command" | "a11y" | "low_level";
  sessionId: string;
  data?: T;
  warning?: string;
  error?: string;
  auditId?: string;
}
```

### Session Model
A session is not browser-only. It binds: policy profile, browser state, terminal state, task history, filesystem working context, audit log references. Sessions persist across CLI invocations via the data store.

## Core Components/Modules
- `cli/` — CLI command handlers organized by surface (browser, terminal, fs, session)
- `api/browser_actions.ts` — high-level browser action API
- `api/terminal_actions.ts` — high-level terminal action API
- `api/fs_actions.ts` — high-level filesystem action API
- `api/session_manager.ts` — session creation, listing, switching, status
- `api/action_result.ts` — unified ActionResult type and helpers

## Data Models/Interfaces
```typescript
interface Session {
  id: string;
  name: string;
  policyProfile: string;
  browserState?: BrowserSessionState;
  terminalState?: TerminalSessionState[];
  fsWorkingDir: string;
  createdAt: string;
  lastActiveAt: string;
  auditLogRef: string;
}
```

## Session/State Implications
- Sessions persist in the data store (~/.browser-control/)
- `bc session use <name>` restores browser connection, terminal state, working directory
- Session state survives CLI process exit
- Multiple sessions can coexist (isolated by policy profile or purpose)

## Permissions/Guardrails Implications
- Every CLI command routes through Section 4's policy engine
- `--profile` flag sets the session policy profile
- `--confirm` flag forces interactive confirmation for require_confirmation decisions
- `--json` output includes policy decision metadata for agent consumption

## Failure/Recovery Behavior
- If browser is not connected, `bc open` auto-launches or attaches per Section 8
- If session doesn't exist, `bc session create` is the suggested recovery
- If a command fails due to policy denial, the error message explains which policy blocked it
- If a command fails due to execution error, the ActionResult includes the error path and retry suggestion

## CLI/API/MCP Implications
- CLI, TypeScript API, and MCP tool schemas must be isomorphic — same actions, same parameters, same output contracts
- CLI adds human-readable formatting on top of the same ActionResult
- MCP tools map 1:1 to API methods (see Section 7 for MCP details)

## Browser/Terminal/FileSystem Path Implications
- Browser actions require an active session with browser state
- Terminal actions require or auto-create a terminal session
- Filesystem actions work with or without a browser/terminal session
- The execution router (Section 4) decides the path, but the action surface is path-agnostic to the caller

## Dependencies on Other Sections
- **Depends on:** Section 4 (policy engine + execution router) — all actions route through policy
- **Depended by:** Section 7 (MCP) — MCP tools wrap these actions
- **Supports:** Section 6 (a11y snapshot) — snapshot is one of the actions
- **Supports:** Section 12 (terminal) — terminal actions are part of this surface

## Risks/Tradeoffs
- **Risk:** CLI surface grows too large. Mitigation: organize by surface prefix (browser/term/fs/sys/session), keep each command simple.
- **Risk:** Three surfaces (CLI/MCP/API) to maintain. Mitigation: API is the source of truth, CLI and MCP are thin wrappers.
- **Tradeoff:** Session persistence adds complexity. Accepted because stateless CLI usage is impractical for multi-step workflows.

## Open Questions
None. `bc open` auto-creates an anonymous session if none is active, while `bc session create` remains available for explicit session naming and isolation.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Study and adapt upstream patterns.**

The action surface ergonomics — command naming, browser interaction patterns, output contracts — should borrow from proven upstream patterns rather than being invented from zero.

**Upstream sources:**
- **browser-use** (Python) — action ergonomics, browser interaction naming, session patterns. Study the API shape and adapt to Browser Control's CLI/API/MCP surface. Translate Python patterns into idiomatic TypeScript.
- **agent-browser** (TypeScript + Rust) — action surface design, snapshot-driven interaction. The command shape and ergonomics are directly relevant.

**What to reuse:**
- Action naming conventions (open, click, fill, snapshot — these are well-established upstream)
- Output contract patterns (structured ActionResult is a common upstream pattern)
- Session binding patterns

**What NOT to reuse:**
- Do not import upstream session models wholesale — Browser Control's session binds browser + terminal + file-system + policy, which no upstream project does
- Do not import upstream CLI structure — Browser Control's CLI surface is its own brand
- Do not assume upstream single-path architecture — Browser Control's action surface spans three paths

**Mixed-language note:** browser-use is Python. Study its action ergonomics and naming conventions, then implement in Browser Control's TypeScript CLI/API/MCP surface. Do not copy Python code — copy the UX ideas.

## Implementation Success Criteria
- A human can use Browser Control manually without reading internals
- An agent can discover and compose actions quickly via MCP or API
- Session persistence works across repeated CLI invocations
- CLI, MCP, and API return consistent results for the same action
- All actions return structured ActionResult with success/path/sessionId/error
