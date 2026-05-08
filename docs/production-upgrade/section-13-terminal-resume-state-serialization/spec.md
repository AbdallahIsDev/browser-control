# Section 13: Terminal Resume and State Serialization

## Purpose
If Browser Control owns terminal sessions, it must preserve continuity across frontend reloads, process restarts, orchestrator reconnects, and long-running task interruptions. Terminal sessions must survive disruption — not just visually, but semantically.

## Why This Section Matters to Browser Control
An agent that loses its terminal context after a daemon restart has to redo everything from scratch. A trading bot that was mid-deploy, a CI pipeline that was mid-build, an SSH session that was mid-edit — all lost. Terminal resume is what makes long-running terminal workflows practical.

## Scope
- Terminal state serialization (cwd, env, history, shell type, prompt signature)
- Scrollback buffer preservation
- Session metadata resume (identity, configuration)
- Buffer resume (visible content, scrollback, cursor position)
- Reconnect behavior (agent reconnects to a resumed session)
- Browser-rendered terminal synchronization (future bridge to Section 6)
- State storage in the same durable store as other session state

## Non-Goals
- Do not promise magical perfect restoration for every arbitrary TUI in v1
- Do not overengineer serialization for apps you don't yet support
- Do not make browser-rendered terminal resume a dependency for native terminal resume
- Do not attempt to checkpoint long-running processes mid-execution (that's a VM-level concern)
- Do not guarantee exact live process continuity across daemon restarts in v1 unless Browser Control later adopts a detached/supervised terminal backend

## User-Facing Behavior
- `bc term list` shows all terminal sessions including resumed ones
- `bc term resume <sessionId>` reconnects to a previously running session
- `bc term status <sessionId>` shows whether the session is live, resumed from metadata/buffer, or reconstructed fresh
- Sessions survive daemon restarts through metadata and buffer recovery in v1, not guaranteed live process continuation

## Agent-Facing Behavior
- Agent reconnects to a terminal session by name/id
- Agent inspects whether the session was resumed from metadata/buffer or reconstructed fresh
- Agent knows whether a command is still running
- Agent continues from prior buffer state — no re-discovery needed
- Resume metadata is explicit and trustworthy (agent knows what was preserved and what was lost)

## Architecture/Design

### Resume Levels

**Level 1: Session metadata resume**
Restore: cwd, env, history, session identity. The shell process is gone but its configuration is preserved. Agent re-opens a new shell with the same settings.

**Level 2: Buffer resume**
Restore: current visible content, scrollback, cursor position, prompt state. The shell process may be gone, but the agent can read what was on screen and understand the context.

### Native Terminal Resume
For PTY-owned sessions:
- Maintain session id, scrollback buffer, shell state metadata, and diagnostic process information where available
- On daemon restart, restore metadata and buffer into a newly opened terminal session
- If buffer was persisted: restore buffer (Level 2 resume), mark as "resumed"
- If no buffer is available: restore metadata only (Level 1 resume), mark as "reconstructed"

In v1, daemon-owned PTY sessions should be assumed to terminate with the daemon unless Browser Control later introduces a detached/supervised terminal backend. The resume contract is therefore metadata/buffer continuity, not exact live process continuity.

### State Serialization Format
```typescript
interface SerializedTerminalSession {
  sessionId: string;
  shell: string;
  cwd: string;
  env: Record<string, string>;
  history: string[];
  promptSignature: string;
  scrollbackBuffer: string[];
  cursorPosition?: { row: number; col: number };
  runningCommand?: string;
  processInfo?: { pid?: number; commandLine?: string };
  status: "idle" | "running" | "interrupted" | "closed";
  resumeLevel: 1 | 2;
  serializedAt: string;
}
```

### Storage
Persist in the same durable store as other session state (SQLite via MemoryStore):
- `terminal_sessions` — session metadata
- `terminal_buffers` — scrollback content
- `terminal_jobs` — running command state
- `terminal_audit` — command history for audit trail

### Browser-Rendered Terminal Bridge
For future use (post-v1 priority): if Browser Control uses browser-rendered terminals (wterm, xterm):
- A11y snapshot continuity should survive page reload
- Rendered state should be restorable from serialized terminal state
- The serialization format should be compatible between native and browser-rendered terminals

### Daemon Integration
On daemon shutdown:
1. For each active terminal session, serialize state at the highest possible resume level
2. Store serialized state in the data store
3. Mark sessions as "pending resume"

On daemon startup:
1. Scan for "pending resume" sessions
2. For each: determine whether metadata and/or buffer were preserved successfully
3. Apply resume level based on what's available
4. Apply terminal recovery policy from config (resume buffer, resume metadata-only, or abandon) rather than reusing task scheduler semantics directly
5. Report resume status per session

## Core Components/Modules
- `terminal/serialize.ts` — state serialization (capture cwd, env, history, buffer, process diagnostics)
- `terminal/resume.ts` — resume logic (restore state, determine resume level)
- `terminal/buffer_store.ts` — scrollback buffer persistence (MemoryStore integration)
- `terminal/process_tracker.ts` — optional diagnostic process tracking used for status/debugging, not required for v1 live resume guarantees

## Data Models/Interfaces
```typescript
interface TerminalResumeResult {
  sessionId: string;
  resumeLevel: 1 | 2;
  status: "resumed" | "reconstructed" | "fresh";
  preserved: {
    metadata: boolean;
    buffer: boolean;
  };
  lost: string[]; // what was not preserved
  session: TerminalSession;
}

interface TerminalBuffer {
  sessionId: string;
  scrollback: string[];
  visibleContent: string;
  cursorPosition?: { row: number; col: number };
  capturedAt: string;
}
```

## Session/State Implications
- Terminal session state is part of the Browser Control session model (Section 5)
- Resumed sessions maintain the same session id — agent doesn't need to update references
- Session status includes resume metadata (level, preserved, lost)
- Terminal state persists across daemon restarts, not just across CLI invocations

## Permissions/Guardrails Implications
- Resuming a session that was running a privileged command: the resume does NOT re-execute the command, it only reconnects to the existing process (which may still be running)
- Serializing environment variables that contain secrets: the serialization must respect the same policy as other state persistence (no secrets in logs, encrypted at rest if policy requires)
- Process reconnection to a shell that had sudo active: the resume doesn't grant new privileges, it only reconnects to the existing process

## Failure/Recovery Behavior
- If the buffer store is corrupt: fall back to Level 1 (metadata only)
- If the session was in a critical state (mid-sudo, mid-deletion): mark as "requires review" and do not auto-resume — agent must explicitly confirm
- If resume fails entirely: create a fresh session with the same configuration, report what was lost
- If multiple sessions need resuming: resume in order, report per-session status

## CLI/API/MCP Implications
- CLI: `bc term list` — includes resumed/reconstructed sessions with their resume level
- CLI: `bc term resume <sessionId>` — explicit reconnect
- CLI: `bc term status <sessionId>` — shows resume level and what was preserved
- MCP: `bc_terminal_resume` — reconnect to a terminal session
- API: `bc.terminal.resume(sessionId)`, `bc.terminal.serialize(sessionId)`

## Browser/Terminal/FileSystem Path Implications
- Terminal resume is specific to the terminal path
- Browser session restore (Section 8) uses a different mechanism (CDP reconnection)
- Filesystem state doesn't need resume (operations are stateless)
- Browser and terminal recovery should share the same policy principles, but terminal recovery uses its own recovery modes rather than reusing task scheduler semantics directly

## Dependencies on Other Sections
- **Depends on:** Section 12 (Terminal) — this section serializes/resumes sessions created by Section 12
- **Depends on:** Section 4 (Policy Engine) — recovery decisions and confirmation flows still route through policy
- **Supports:** Section 5 (Agent Action Surface) — resumed sessions are part of the session model
- **Supports:** Section 10 (Observability) — resume status is part of health checks and debug bundles

## Risks/Tradeoffs
- **Risk:** Scrollback buffers can be large. Mitigation: configurable buffer size limit, truncate oldest lines first.
- **Risk:** Serialization adds latency to shutdown. Mitigation: serialize asynchronously, buffer is the expensive part (stream it to disk).
- **Tradeoff:** v1 guarantees metadata/buffer recovery rather than full process continuity. Accepted — this is implementable and trustworthy without a detached terminal supervisor.

## Open Questions
- Should serialized terminal state be encrypted at rest? Recommendation: not by default (data dir is already user-private), but support encryption for environments where it's required.
- Should there be a maximum number of serializable sessions? Recommendation: configurable limit, default 10.
- Should true live process continuity be added later via a detached terminal supervisor or multiplexer layer? Recommendation: yes, but explicitly as a post-v1 architecture addition, not a hidden v1 promise.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Study terminal serialization patterns from upstream, own resume semantics.**

Terminal state serialization and resume have been approached by various upstream projects. Browser Control should not reinvent the serialization mechanics if proven patterns exist, but it must own the resume semantics and session model integration.

**Upstream sources:**
- **wterm** — terminal state serialization, scrollback preservation, browser-rendered terminal continuity.
- Terminal ecosystem — PTY session persistence patterns, process tracking approaches.

**What to reuse:**
- Scrollback buffer serialization patterns
- Process liveness detection approaches (PID tracking, process signature matching)
- Terminal state capture formats (cwd, env, history, prompt)
- Graceful degradation patterns (what to do when exact process continuity is impossible)

**What NOT to reuse:**
- Do not import upstream's resume semantics — Browser Control defines its own resume levels (metadata/buffer/process) and integrates with its session model
- Do not import upstream's lack of policy integration — resumed sessions must respect Browser Control's policy engine
- Do not assume upstream's single-terminal model — Browser Control sessions can have multiple terminal sessions alongside browser sessions

**Mixed-language note:** Terminal serialization approaches may be in any language. Study the state capture and serialization patterns, then implement in Browser Control's TypeScript with its own data store (MemoryStore/SQLite).

## Implementation Success Criteria
- Normal shell sessions survive daemon restarts well through Level 1 or 2 resume
- Agents can reconnect without losing context (same session id, same cwd, same history)
- Resume metadata is explicit and trustworthy (agent knows resume level and what was lost)
- Browser and native terminal surfaces can eventually share the same continuity model
- Scrollback buffer is preserved reliably across restarts
- v1 does not falsely claim live process continuation when only metadata/buffer were restored
