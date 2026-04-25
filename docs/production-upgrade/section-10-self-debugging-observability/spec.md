# Section 10: Self-Debugging and Observability

## Purpose
Real automation fails. The system must explain why, provide enough evidence for self-correction, and make long workflows debuggable after the fact. This section makes Browser Control reliable by making its failures diagnosable.

## Why This Section Matters to Browser Control
An agent that fails silently is useless. An agent that fails and says "error" is barely better. Browser Control must produce structured evidence on failure: what was the goal, what path was taken, what step failed, what was on the page, what did the console say, what did the network do. This evidence lets the agent retry intelligently or the human diagnose remotely.

## Scope
- Structured logging (already partially done via Logger class)
- Browser console capture
- Browser network capture
- Screenshot capture on failure
- A11y snapshot capture on failure
- Task trace bundles (full evidence package per failure)
- Browser health checks (CDP reachability, tab integrity, crash detection)
- Terminal health checks (PTY alive, prompt recognized, buffer integrity)
- System health checks (disk, memory, queue pressure)
- Performance instrumentation (traces, slow step detection)
- Agent recovery guidance (retry? different path? escalate? human intervention?)

## Non-Goals
- Do not overload every normal action with expensive tracing
- Do not depend entirely on one external debug tool
- Do not make observability browser-only (terminal and system must be covered)
- Do not build a full APM system in v1

## User-Facing Behavior
- `bc doctor` checks system health
- `bc status` shows current state of all components
- `bc debug bundle <taskId>` exports a failure bundle for analysis
- Failed steps include clear error messages with context

## Agent-Facing Behavior
- Failed steps return structured evidence: task id, session id, execution path, recent actions, policy decisions, browser URL/title, snapshot, screenshot, console errors, network errors, exception stack, retry summary
- Agent uses this evidence to decide: retry same step, choose another path, escalate for confirmation, require human intervention
- Agent can query health status before starting work (is the browser connected? is the terminal alive?)

## Architecture/Design

### Debug Bundle
When a step fails, the system produces a bundle:
```typescript
interface DebugBundle {
  taskId: string;
  sessionId: string;
  executionPath: "command" | "a11y" | "low_level";
  failedStep: RoutedStep;
  recentActions: ActionHistory[];
  policyDecisions: AuditEntry[];
  browser?: {
    url: string;
    title: string;
    snapshot: A11yElement[];
    screenshot?: string; // base64 or file path
    consoleErrors: ConsoleEntry[];
    networkErrors: NetworkEntry[];
  };
  terminal?: {
    sessionId: string;
    lastOutput: string;
    exitCode?: number;
    promptState: string;
  };
  exception: {
    message: string;
    stack?: string;
    code?: string;
  };
  retrySummary: {
    attempts: number;
    totalDurationMs: number;
    backoffUsed: boolean;
  };
}
```

### Health Checks

**Browser health:**
- CDP reachability (can we ping the browser?)
- Tab/session integrity (are expected tabs still open?)
- Console crash signals (did the page crash?)
- Detached frame detection (are iframes still accessible?)
- Reconnect viability (can we recover the connection?)

**Terminal health:**
- PTY process alive (is the shell process still running?)
- Shell prompt recognized (can we detect the prompt?)
- Scrollback still attached (is the buffer accessible?)
- Session buffer integrity (is the output coherent?)
- Idle/running/interrupted state

**System health:**
- Disk space (is the data directory writable and not full?)
- Memory usage (heap and RSS)
- Queue pressure (how many tasks are pending?)
- Worker health (are background workers alive?)
- Policy/config integrity (is the policy config valid?)

### Performance Instrumentation
Not on by default for every task. Supports:
- Traces (start/end/duration per step)
- Network timing (request latency, response size)
- Slow step detection (steps exceeding expected duration)
- Memory snapshots where relevant (large page processing)

### Agent Recovery Guidance
A failed step returns not just an error, but structured guidance:
```typescript
interface RecoveryGuidance {
  canRetry: boolean;
  retryReason?: string;
  alternativePath?: "command" | "a11y" | "low_level";
  alternativeReason?: string;
  requiresConfirmation: boolean;
  confirmationReason?: string;
  requiresHuman: boolean;
  humanReason?: string;
}
```

## Core Components/Modules
- `observability/debug_bundle.ts` — bundle assembly on failure
- `observability/health_check.ts` — browser/terminal/system health checks (extend existing health_check.ts)
- `observability/console_capture.ts` — browser console log capture
- `observability/network_capture.ts` — browser network event capture
- `observability/performance.ts` — traces and slow step detection
- `observability/recovery.ts` — recovery guidance generation

## Data Models/Interfaces
```typescript
interface HealthStatus {
  component: "browser" | "terminal" | "system";
  healthy: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    details?: string;
  }>;
  timestamp: string;
}

interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: string;
  source?: string;
}

interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  error?: string;
  timestamp: string;
  durationMs?: number;
}
```

## Session/State Implications
- Debug bundles are stored per-task in the data store
- Health status is cached briefly (30s) to avoid hammering CDP/PTY with checks
- Console/network capture is scoped to the current page/session
- Performance traces are opt-in per task (not default)

## Permissions/Guardrails Implications
- Console capture is `low` risk (read-only)
- Network capture is `moderate` risk (may expose sensitive URLs)
- Screenshot capture is `moderate` risk (may expose sensitive content)
- Exporting debug bundles is `moderate` risk (contains session evidence)
- All governed by Section 4's policy engine

## Failure/Recovery Behavior
- If the debug bundle assembly itself fails, return a minimal bundle with just the exception
- If health checks fail to run, report the health check as "unknown" rather than "unhealthy"
- If screenshot capture times out, skip it and include a placeholder — don't block the bundle
- If the browser is fully disconnected, the debug bundle includes the disconnection as the root cause

## CLI/API/MCP Implications
- CLI: `bc doctor` — full health check across all components
- CLI: `bc status` — current state summary
- CLI: `bc debug bundle <taskId>` — export debug bundle as JSON
- CLI: `bc debug console` — stream browser console in real-time
- CLI: `bc debug network` — stream browser network events
- MCP: `bc_debug_health`, `bc_debug_failure_bundle`, `bc_debug_get_console`, `bc_debug_get_network`
- API: `bc.debug.bundle(taskId)`, `bc.debug.health()`, `bc.debug.console(page)`

## Browser/Terminal/FileSystem Path Implications
- Browser path: debug bundle includes snapshot, screenshot, console, network
- Terminal path: debug bundle includes last output, exit code, prompt state
- Filesystem path: debug bundle includes file paths and operation details
- System path: debug bundle includes process/service state
- Each path contributes its own evidence to the bundle

## Dependencies on Other Sections
- **Depends on:** Section 4 (Policy Engine) — policy decisions are part of the debug bundle
- **Depends on:** Section 5 (Agent Action Surface) — action history feeds the bundle
- **Depends on:** Section 6 (A11y Snapshot) — snapshot is captured on failure
- **Depends on:** Section 8 (Browser Sessions) — browser health depends on connection state
- **Supports:** Section 9 (Knowledge System) — failure patterns can trigger knowledge capture
- **Depended by:** All sections — observability is cross-cutting

## Risks/Tradeoffs
- **Risk:** Debug bundles are expensive to assemble (screenshots, snapshots, network logs). Mitigation: assemble lazily, skip expensive parts on timeout, allow opt-in for full bundles.
- **Risk:** Console/network capture adds overhead to every page. Mitigation: capture is scoped and can be disabled.
- **Risk:** Health checks are too noisy. Mitigation: cache health status, only alert on state changes.
- **Tradeoff:** Full observability adds complexity to every action. Accepted — the alternative (silent failures) is worse.

## Open Questions
- Should debug bundles be compressed for storage? Recommendation: yes for long-lived bundles, no for in-memory.
- Should there be a debug bundle viewer? Recommendation: JSON output is sufficient for v1, viewer is post-v1.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Reuse proven DevTools debugging concepts, adapt into Browser Control runtime.**

Browser debugging, console capture, network capture, and performance traces are well-established concepts in the Chrome DevTools ecosystem. Browser Control should not rebuild these from scratch.

**Upstream sources:**
- **chrome-devtools-mcp** (TypeScript) — CDP-based debugging, console/network capture patterns.
- Chrome DevTools protocol itself — the CDP domains for Console, Network, Performance are the upstream "API" for observability.

**What to reuse:**
- Console capture patterns (CDP Runtime/Console domains)
- Network capture patterns (CDP Network domain)
- Performance trace concepts (CDP Performance domain)
- Health check patterns (CDP target/session integrity)
- Debug bundle structure (common pattern in automation frameworks)

**What NOT to reuse:**
- Do not depend entirely on one external debug tool — Browser Control's observability should work across browser AND terminal paths
- Do not import browser-only observability patterns — terminal path needs equivalent observability
- Do not assume CDP is always available — observability should degrade gracefully

**Mixed-language note:** chrome-devtools-mcp is TypeScript — direct study is straightforward. The CDP protocol itself is language-agnostic (JSON-over-WebSocket), so patterns from any language's CDP client apply.

## Implementation Success Criteria
- Failures are diagnosable from the debug bundle alone (no need to reproduce)
- Agents can self-correct more often using recovery guidance
- Long workflows are debuggable after the fact via stored bundles
- Browser and terminal paths have equivalent observability quality
- Health checks detect common failure modes (Chrome crash, terminal death, disk full)
- Debug bundle assembly completes in <5s for typical failures
