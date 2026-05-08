# Section 4: Policy Engine + Execution Router

## Purpose
Browser Control must never behave like an unbounded local agent with silent machine authority by default. This section defines how tasks are routed across execution surfaces, how risk is classified, how permissions are enforced, and how users can safely widen authority over time. This is the architectural foundation for the entire product.

## Why This Section Matters to Browser Control
Without a unified policy engine, every execution path (browser, terminal, file/system) implements its own ad hoc permission logic — or worse, none at all. An AI agent with terminal + browser + filesystem access and no policy layer is a liability. This section makes Browser Control powerful *and* intentionally powerful.

## Scope
- Policy model that applies uniformly across command, browser, and low-level paths
- Execution router that selects the right path for each task or step
- Risk taxonomy for all actions (low / moderate / high / critical)
- Allowlists, denylists, and confirmation rules per policy category
- Profile-based execution modes: `safe`, `balanced`, `trusted`
- Audit logging of every policy decision
- Hybrid policy model as default (profile + per-action overrides)

## Non-Goals
- No invisible "trust me" mode by default
- No free-form string-based permission checks
- No browser-only permission model
- No command-only permission model
- No ACP integration in v1

## User-Facing Behavior
- User can select a session policy profile (`safe`, `balanced`, `trusted`)
- User can inspect effective permissions for the current session
- User can pre-authorize a task scope before execution
- User can approve a one-off risky action when `require_confirmation` is returned
- User can revoke a prior grant
- User can export/import policy presets

## Agent-Facing Behavior
- Every action returns a policy decision: `allow`, `allow_with_audit`, `require_confirmation`, or `deny`
- Agent receives structured risk classification for each step it proposes
- Agent can query the policy engine before proposing actions to avoid wasted planning
- Agent can request confirmation escalation when `require_confirmation` is returned

## Architecture/Design

### Execution Pipeline
Every task flows through: Task Intent → Policy Evaluation → Execution Routing → Path Execution → Observation/Verification → Retry/Recovery/Escalation → State Persistence → Telemetry/Audit Logging

### Execution Router
The router decides which execution path should run each task step. Preferred order:
1. **Command path** — if the task can be solved by shell commands, CLI tools, filesystem ops, or service control
2. **A11y path** — if the task requires a browser page/Electron app and targets are available via accessibility snapshot
3. **Low-level fallback** — CDP, DOM, network interception, screenshots, coordinate tools

The router is a planner at the execution-surface level, not just a dispatcher. It decides: can this be completed by shell commands faster? Does this require a browser? Is the browser target accessible through a11y? Is low-level fallback needed? Should a multi-step task mix paths?

### Policy Categories
Each category has its own allowlist/denylist/confirmation rules:

**Command Policies:** allow shell execution, deny destructive commands unless confirmed, allow only subset of binaries, restrict write access to approved directories, restrict network calls from shell, restrict process spawning, restrict service control.

**Filesystem Policies:** read-only paths, writable paths, deny recursive delete by default, allow temp directories automatically, require confirmation for home directory writes, require confirmation for system-level paths.

**Browser Policies:** allowed domains, blocked domains, file upload/download allowed/denied, screenshot allowed/denied, clipboard access allowed/denied, popup handling, allow login pages but require confirmation before submitting credentials, allow automation only in explicit sessions.

**Low-Level Policies:** raw CDP access, coordinate actions, JS evaluation, network interception, cookie export/import, performance trace, console/network capture.

### Risk Levels
Every action carries one of: `low` (open URL, read title), `moderate` (type text, create file in allowed dir), `high` (click submit, upload file, overwrite file), `critical` (recursive delete, transfer funds, place trade, modify system config, raw elevated shell).

### Decision Behavior
Policy engine returns: `allow` | `allow_with_audit` | `require_confirmation` | `deny`

## Core Components/Modules
- `policy_engine.ts` — core policy evaluation, profile management, rule matching
- `execution_router.ts` — path selection logic, multi-step routing
- `policy_profiles.ts` — built-in profiles (safe/balanced/trusted) and custom profile loading
- `policy_audit.ts` — audit trail for every policy decision
- `risk_classifier.ts` — action-to-risk-level mapping

## Data Models/Interfaces
```typescript
type ExecutionPath = "command" | "a11y" | "low_level";
type PolicyDecision = "allow" | "allow_with_audit" | "require_confirmation" | "deny";
type RiskLevel = "low" | "moderate" | "high" | "critical";

interface TaskIntent {
  goal: string;
  actor: "human" | "agent";
  sessionId: string;
  requestedPath?: ExecutionPath;
  metadata?: Record<string, unknown>;
}

interface RoutedStep {
  id: string;
  path: ExecutionPath;
  action: string;
  params: Record<string, unknown>;
  risk: RiskLevel;
}

interface PolicyEngine {
  evaluate(step: RoutedStep, context: ExecutionContext): PolicyDecision;
}

interface PolicyProfile {
  name: string;
  commandPolicy: CommandPolicy;
  filesystemPolicy: FilesystemPolicy;
  browserPolicy: BrowserPolicy;
  lowLevelPolicy: LowLevelPolicy;
}

interface AuditEntry {
  timestamp: string;
  sessionId: string;
  step: RoutedStep;
  decision: PolicyDecision;
  reason: string;
}
```

## Session/State Implications
- Each session binds to a policy profile at creation
- Policy profile cannot be downgraded mid-session without user confirmation (e.g., `safe` → `trusted` requires explicit approval)
- Audit trail persists per session in the data store
- Policy decisions are stored alongside task history for reproducibility

## Permissions/Guardrails Implications
This IS the permissions layer. All other sections (browser, terminal, filesystem) route through this engine. No path may bypass policy. Even "internal" operations like health checks that write to disk must go through the policy engine with appropriate risk classification.

## Failure/Recovery Behavior
- If the policy engine itself fails to evaluate (corrupt config, missing profile), default to `deny` — fail closed, never fail open
- If audit logging fails, the action should still proceed (audit failure is not a blocker) but a warning must be emitted
- Profile corruption on disk: fall back to `safe` profile, alert user

## CLI/API/MCP Implications
- CLI: `bc --profile <safe|balanced|trusted>` to set session profile
- CLI: `bc policy inspect` shows effective permissions
- CLI: `bc policy export <file>` / `bc policy import <file>` for preset management
- MCP: policy decisions are returned in every tool response
- API: `bc.policy.evaluate(step)` available programmatically
- All three surfaces (CLI, MCP, API) must show consistent policy behavior

## Browser/Terminal/FileSystem Path Implications
- Browser actions route through browser policy
- Terminal actions route through command policy
- File/system actions route through filesystem policy
- Low-level fallback actions (CDP, DOM, screenshots) route through low-level policy
- Mixed-path tasks evaluate policy per step, not per task

## Dependencies on Other Sections
- **Depended by:** Section 5 (Agent Action Surface), Section 7 (MCP), Section 8 (Browser), Section 12 (Terminal) — all action surfaces must route through policy
- **Depends on:** None — this is the foundation

## Risks/Tradeoffs
- **Risk:** Policy engine adds latency to every action. Mitigation: in-memory evaluation, no disk reads per decision, cache profiles.
- **Risk:** Overly restrictive defaults frustrate power users. Mitigation: `balanced` profile is the recommended default, not `safe`.
- **Risk:** Complex rule matching becomes untestable. Mitigation: rules are declarative (allowlist/denylist), not arbitrary code.
- **Tradeoff:** Centralized policy is a single point of failure. Accepted because distributed per-path policy is harder to audit and more likely to have gaps.

## Open Questions
None — the roadmap defines this section completely.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Reimplement in Browser Control (differentiator).**

This is Browser Control's core differentiator. No upstream project has a unified policy engine that governs browser, terminal, and file/system operations with a single risk taxonomy and decision model.

- Do not outsource the policy engine to external repos
- Do not blindly copy another project's permission model — they are all single-surface (browser-only or command-only)
- Browser Control owns this layer completely
- Inspiration for risk classification patterns may come from upstream projects, but the architecture and implementation must be Browser Control-native
- The execution router is also a differentiator — no upstream project routes across command/a11y/low-level paths

**Mixed-language note:** Even if upstream projects in Python/Rust have interesting permission models, do not adapt them — Browser Control's cross-surface policy architecture is fundamentally different from anything that exists upstream.

## Implementation Success Criteria
- Every action (browser, terminal, filesystem, low-level) runs through one policy engine
- Every risky action is explainable after the fact via audit trail
- The same policy model governs browser, terminal, and file/system work
- No path bypasses policy because it is "internal"
- Three built-in profiles work correctly (safe blocks high/critical, balanced requires confirmation, trusted allows with audit)
- Policy evaluation adds <1ms latency per decision
