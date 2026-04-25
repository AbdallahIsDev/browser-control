# Section 12: Native Terminal Automation Layer

## Purpose
Agents prefer terminal-first execution whenever possible — it is faster, cheaper, less flaky, and more composable than browser automation. Browser Control must own native terminal sessions directly, providing a first-class command path that sits alongside the browser path.

## Why This Section Matters to Browser Control
A system that only automates the browser is half a product. Most real work involves: running scripts, managing files, starting services, querying APIs, processing data — all terminal work. The execution router (Section 4) needs a real terminal path to route to, not a conceptual placeholder.

## Scope
- PTY-backed terminal sessions (real shell, not child_process wrappers)
- Shell lifecycle control (open, close, interrupt)
- Command execution (structured exec mode)
- Interactive session mode (persistent shell with streaming I/O)
- Output capture (stdout, stderr, exit code, duration)
- Prompt detection
- Session persistence within daemon lifetime
- File/system structured operations (read, write, move, list, delete, stat, process list/control)
- Cross-platform shell support (PowerShell/pwsh, bash/sh)
- Safety model integration (terminal execution through policy engine)

## Non-Goals
- Do not try to support every terminal emulator feature in v1
- Do not build a full tmux clone
- Do not hide filesystem operations exclusively behind shell commands (structured APIs are also needed)
- Do not support every shell variant in v1 (PowerShell + bash + sh is sufficient)

## User-Facing Behavior
- `bc term open` opens a persistent shell session
- `bc term exec "ls -la"` runs a one-shot command and returns output
- `bc term type "git status"` types into an interactive session
- `bc term snapshot` captures current terminal state (like browser snapshot but for terminal)
- `bc term read` reads recent output from a running session
- `bc term interrupt` sends Ctrl+C to a running command
- `bc term close` closes the session
- `bc fs read <path>`, `bc fs write <path>` — structured file operations

## Agent-Facing Behavior
- Agent opens a terminal session and gets a session handle
- Agent executes commands and receives structured results (stdout, stderr, exit code, duration)
- Agent can maintain persistent sessions (shell remembers cwd, env, history)
- Agent can run background commands and poll for output
- Agent interacts with the terminal path identically to how it interacts with the browser path — same session model, same policy integration, same output contracts

## Architecture/Design

### Execution Modes

**Structured exec mode:**
Run a command, capture: exit code, stdout, stderr, duration, working directory. Returns when command completes. Best for one-shot operations.

**Interactive session mode:**
Maintain a real shell session with: prompt, process state, long-running command support, streaming output, stdin input. Best for REPLs, interactive tools, SSH sessions, trading CLIs.

### Terminal Abstraction
```typescript
interface TerminalSession {
  id: string;
  shell: string; // "bash", "pwsh", "sh"
  cwd: string;
  env: Record<string, string>;
  status: "idle" | "running" | "interrupted" | "closed";

  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  write(data: string): Promise<void>;
  read(): Promise<string>;
  snapshot(): Promise<TerminalSnapshot>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
```

### Why PTY Matters
A true PTY is needed because many tools behave differently without one: shell prompts, full-screen apps, color output, REPLs, trading CLIs, SSH sessions, package managers, interactive setup tools. Node.js `child_process` without PTY does not produce usable output for these.

### Command Model
- **One-shot commands:** exec → capture → return
- **Persistent shells:** open → exec/write/read → close. Shell remembers state between commands.
- **Environment-scoped sessions:** session with custom env vars
- **Working-directory-aware sessions:** session with custom cwd
- **Long-running background sessions:** exec with background flag, poll for output

### File/System Structured Operations
Not all file/system work should go through the shell. First-class APIs for:
- Reading files (with encoding detection)
- Writing files (atomic where possible)
- Moving/renaming files
- Listing directories (with metadata)
- Deleting files (with confirmation for recursive)
- Stat metadata
- Process listing
- Process control (kill, signal)

The router can still choose shell commands internally, but the public model supports structured operations too.

### Safety Model
Terminal execution is the highest-leverage surface and must be tightly guarded:
- Harmless reads: `low` risk
- Arbitrary shell execution: `moderate` or `high` risk
- Recursive delete: `critical` risk
- Package installs: `high` depending on scope
- `sudo`, service modification, system config changes: `critical` risk

All terminal actions route through Section 4's policy engine.

### Cross-Platform
Minimum v1 support:
- Windows: PowerShell (`powershell`) / PowerShell Core (`pwsh`)
- Linux: `bash` / `sh`
- macOS: `bash` / `zsh` where available

Do not assume every shell behaves identically. Shell detection is platform-aware.

## Core Components/Modules
- `terminal/session.ts` — PTY session management, lifecycle, I/O
- `terminal/exec.ts` — structured exec mode (one-shot commands)
- `terminal/prompt.ts` — prompt detection across shells
- `terminal/snapshot.ts` — terminal state capture (like a11y snapshot for terminal)
- `terminal/cross_platform.ts` — shell detection, platform-specific behavior
- `fs/operations.ts` — structured file/system operations
- `fs/watcher.ts` — file change detection (optional, post-v1 priority)

## Data Models/Interfaces
```typescript
interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  background?: boolean;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd: string;
  timedOut: boolean;
}

interface TerminalSnapshot {
  sessionId: string;
  shell: string;
  cwd: string;
  env: Record<string, string>;
  status: "idle" | "running" | "interrupted" | "closed";
  lastOutput: string;
  promptDetected: boolean;
  scrollbackLines: number;
  runningCommand?: string;
}

interface TerminalSessionConfig {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}
```

## Session/State Implications
- Terminal sessions are part of the Browser Control session model (Section 5)
- A session can have multiple terminal sessions (just as it can have multiple browser tabs)
- Terminal session state (cwd, env, history) persists within the daemon lifetime
- Terminal state serialization for cross-restart persistence is covered in Section 13

## Permissions/Guardrails Implications
- All terminal execution routes through Section 4's policy engine
- Command policies apply: allowed binaries, restricted directories, restricted network, restricted process spawning
- Filesystem policies apply: read-only paths, writable paths, recursive delete denial
- Critical operations (sudo, system config) require confirmation in safe/balanced profiles

## Failure/Recovery Behavior
- If the PTY process dies unexpectedly, report as session-expired with last known output
- If a command times out, interrupt it and return partial output + timeout flag
- If shell detection fails, fall back to `sh` on Unix, `powershell` on Windows
- If a structured file operation fails, return structured error (not shell error text)
- If the terminal session's cwd is deleted, report and suggest reopening at a valid path

## CLI/API/MCP Implications
- CLI: `bc term open/exec/type/snapshot/read/interrupt/close`
- CLI: `bc fs ls/read/write/move/rm`
- CLI: `bc sys process list` / `bc sys service status <name>`
- MCP: `bc_terminal_open/exec/read/write/interrupt/snapshot`
- MCP: `bc_fs_read/write/list/move/delete`
- MCP: `bc_sys_process_list/kill/service_status`
- API: `bc.terminal.open()`, `bc.terminal.exec()`, `bc.fs.read()`, etc.

## Browser/Terminal/FileSystem Path Implications
- Terminal is a first-class execution path alongside browser
- File/system operations are their own sub-path (not nested under terminal)
- The execution router (Section 4) can route tasks to terminal, browser, or mix both
- Terminal and browser paths share the same session model, policy engine, and output contracts

## Dependencies on Other Sections
- **Depends on:** Section 4 (Policy Engine) — all terminal actions route through policy
- **Depends on:** Section 5 (Agent Action Surface) — terminal actions are part of the action surface
- **Supports:** Section 6 (A11y Snapshot) — browser-rendered terminal snapshots
- **Supports:** Section 13 (Terminal Resume) — this section creates the sessions that Section 13 serializes
- **Depended by:** Section 7 (MCP) — terminal tools need working terminal sessions

## Risks/Tradeoffs
- **Risk:** PTY libraries are platform-dependent and buggy. Mitigation: use a well-tested PTY library (node-pty), test on all 3 platforms, graceful fallback.
- **Risk:** Prompt detection is unreliable across shells. Mitigation: configurable prompt patterns, fallback to timeout-based detection.
- **Risk:** Terminal output can be enormous. Mitigation: output limits, truncation with tail semantics, streaming for large outputs.
- **Tradeoff:** PTY adds a native dependency (node-pty). Accepted because without PTY, interactive tools don't work.

## Open Questions
- Should file operations be a separate CLI prefix (`bc fs`) or nested under terminal (`bc term fs`)? Recommendation: separate prefix — file ops don't require a terminal session.
- Should we support Windows `cmd.exe` in addition to PowerShell? Recommendation: no for v1 — PowerShell is the modern Windows shell.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Vendor/adapt terminal rendering, own orchestration and session integration.**

Browser Control owns native terminal sessions directly (PTY lifecycle, command execution, session model). But terminal rendering fundamentals — especially for browser-rendered terminals — should not be written from scratch.

**Upstream sources:**
- **wterm** (TypeScript/JS) — browser-rendered terminal with semantic DOM structure. Directly relevant for terminal a11y snapshots.
- **browser-harness** — terminal interaction patterns, if it has terminal components.
- Terminal ecosystem generally (node-pty, xterm.js concepts) — PTY management, terminal state capture.

**What to reuse:**
- PTY session management patterns (node-pty is a standard dependency, not something to rebuild)
- Terminal rendering layer for browser-rendered terminals (wterm or similar)
- Terminal state capture patterns (scrollback, cursor position, prompt detection)
- Cross-platform shell detection patterns

**What NOT to reuse:**
- Do not rebuild terminal fundamentals (PTY, shell spawning, signal handling) — use established libraries
- Do not import upstream's terminal-only session model — Browser Control's terminal sessions are part of a unified session with browser + file-system
- Do not import upstream's lack of policy integration — Browser Control terminal execution goes through the policy engine
- Browser Control should focus its native work on orchestration, session binding, policy integration, and path routing — not on rebuilding terminal rendering

**Mixed-language note:** wterm's implementation may be in mixed languages. Study its approach to exposing terminal content as semantic DOM, then adapt into Browser Control's TypeScript a11y snapshot layer. The terminal rendering engine itself may be reused as-is if it's a usable library.

## Implementation Success Criteria
- Terminal-first tasks are practical (agent can install deps, run scripts, manage files via terminal)
- Agents can use shell sessions predictably (consistent output, reliable prompt detection)
- Interactive tools work (REPLs, SSH, package managers, setup wizards)
- File/system work integrates naturally with terminal sessions
- Cross-platform: works on Windows (PowerShell), Linux (bash), macOS (bash/zsh)
- Terminal execution respects policy engine (destructive commands blocked/confirmed)
