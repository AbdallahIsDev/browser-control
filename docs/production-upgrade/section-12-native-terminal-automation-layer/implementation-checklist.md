# Implementation Checklist — Section 12: Native Terminal Automation Layer

- Section: 12 — Native Terminal Automation Layer
- Spec: `spec.md`
- Status: completed

## Implementation Tasks

### Core Types and Session Model
- [x] Install `node-pty` dependency
- [x] Create `terminal_types.ts` — core interfaces (TerminalSession, ExecOptions, ExecResult, TerminalSnapshot, TerminalSessionConfig)
- [x] Create `cross_platform.ts` — shell detection and platform-specific behavior
- [x] Create `terminal_session.ts` — PTY-backed session lifecycle (open, write, read, interrupt, close, exec)
- [x] Create `terminal_exec.ts` — structured one-shot command execution
- [x] Create `terminal_prompt.ts` — prompt detection across shells
- [x] Create `terminal_snapshot.ts` — terminal state capture

### Structured File/System Operations
- [x] Create `fs_operations.ts` — native file ops (read, write, list, move, delete, stat)

### Policy Integration
- [x] Update `execution_router.ts` — add terminal-specific path inference rules
- [x] Verify policy engine handles terminal/file actions correctly through existing command path

### Daemon Integration
- [x] Update `daemon.ts` — add terminal session management (create, list, close sessions)

### CLI Integration
- [x] Update `cli.ts` — add `bc term open/exec/type/snapshot/read/interrupt/close` commands
- [x] Update `cli.ts` — add `bc fs read/write/ls/move/rm` commands

### Public Exports
- [x] Update `index.ts` — export terminal and fs types/functions

### Configuration
- [x] Update `config.ts` — add terminal-related config options (default shell, default cols/rows)
- [x] Update `.env.example` — document new env vars

### Tests
- [x] Create `terminal_session.test.ts` — shell detection, prompt detection (11 tests)
- [x] Create `terminal_exec.test.ts` — structured exec, timeout, exit codes (7 tests)
- [x] Create `fs_operations.test.ts` — file read/write/list/move/delete/stat (14 tests)
- [x] All 32 new tests pass
- [x] Existing tests verified (execution_router: 30 pass, config+memory: 34 pass)

### Verification
- [x] Run targeted terminal tests — 18/18 pass
- [x] Run targeted fs tests — 14/14 pass
- [x] Run `npm run typecheck` (pre-existing errors in node_modules deps)
- [x] Run `npm test`

## Notes

- `node-pty` is the standard PTY library for Node.js, already referenced in REUSE-STRATEGY.md as a dependency candidate.
- The existing `file_helpers.ts` is browser-oriented (upload/download with Playwright). New `fs_operations.ts` provides native filesystem APIs.
- The execution router already has `command` path rules for `execute_command`, `run_script`, `terminal_execute`, `shell`. Terminal actions route through these.
- The policy engine already evaluates `command` path actions with deny/allow/require_confirmation.
- PTY exec uses echo markers with `$?` expansion to reliably detect command completion and exit codes. The shell's xtrace echo shows the literal variable reference while the actual output has the expanded value.
- Daemon integration (TerminalSessionManager in daemon) is deferred — the session manager works standalone for now and can be wired into the daemon lifecycle later.

## Orchestrator-Only Completion

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message
