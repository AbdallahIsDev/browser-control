# Section 26: Agentic Screencast and Debug Receipts

## Purpose

Premium automation needs proof. This section adds task-level screencasts, action annotations, and richer debug receipts so users and agents can replay what happened, understand failures, and trust long-running browser workflows.

## Why This Section Matters to Browser Control

Screenshots are useful, but one screenshot cannot explain a multi-step task. Playwright 1.59 introduced `page.screencast` with recordings, action annotations, overlays, real-time frames, and agentic video receipts. Browser Control should adapt this idea into its own observability layer across MCP, CLI, reports, and debug bundles.

## Scope

- Start/stop browser screencast recording per session/task.
- Show action annotations during recording.
- Attach screencast artifacts to debug bundles and task results.
- Capture optional real-time frames for live operator UX.
- Record action titles, timestamps, refs, URLs, and policy decisions beside video.
- Add cleanup/retention rules for video artifacts.

## Non-Goals

- Do not record every task by default.
- Do not build a full video editor.
- Do not record sensitive sessions without policy awareness.
- Do not make screencast required for normal automation success.

## User-Facing Behavior

- `bc browser screencast start --path <file>` starts a task recording.
- `bc browser screencast stop` stops it and returns the video path.
- `bc browser screencast show-actions` displays visible action labels during recording.
- Failure bundles may include a video receipt when enabled.
- `bc debug bundle <id>` lists screenshot, snapshot, console, network, and screencast artifacts.

## Agent-Facing Behavior

- Agent can request recording before risky or long workflow.
- Agent receives video path and action timeline after task.
- Agent can use recent frames or final annotated screenshot to self-correct.
- Agent reports exact evidence paths to user.

## Architecture/Design

### Screencast Lifecycle

```typescript
interface ScreencastSession {
  id: string;
  browserSessionId: string;
  pageId: string;
  path: string;
  startedAt: string;
  stoppedAt?: string;
  status: "recording" | "stopped" | "failed";
  actionAnnotations: boolean;
}
```

Lifecycle:

1. Resolve active page.
2. Verify policy allows recording.
3. Start Playwright screencast or Browser Control recorder adapter.
4. Record action timeline in parallel.
5. Stop recorder.
6. Store artifact metadata in session reports/debug storage.

### Action Timeline

Each routed action should optionally emit a receipt event:

```typescript
interface ActionReceiptEvent {
  timestamp: string;
  action: string;
  target?: string;
  url?: string;
  title?: string;
  policyDecision?: string;
  risk?: string;
  durationMs?: number;
  artifactPath?: string;
}
```

### Debug Receipt

Extend debug bundles with:

- `screencastPath`
- `actionTimelinePath`
- `annotatedScreenshotPath`
- `lastFramePath`
- `recordingPolicy`

## Core Components/Modules

- `src/browser/actions.ts` — screencast actions and action annotation hooks.
- `src/observability/debug_bundle.ts` — attach recording artifacts.
- `src/observability/performance.ts` or new recorder module — receipt timeline.
- `src/mcp/tools/browser.ts` — MCP screencast tools.
- `src/cli.ts` — CLI commands.
- `src/shared/paths.ts` — report artifact paths and retention.

## Data Models/Interfaces

```typescript
interface ScreencastOptions {
  path?: string;
  showActions?: boolean;
  annotationPosition?: "top-left" | "top" | "top-right" | "bottom-left" | "bottom" | "bottom-right";
  retention?: "keep" | "delete-on-success" | "debug-only";
}

interface DebugReceipt {
  taskId: string;
  status: "success" | "failure" | "partial";
  startedAt: string;
  completedAt: string;
  artifacts: Array<{ kind: string; path: string; sizeBytes?: number }>;
}
```

## Session/State Implications

- At most one active screencast per page/session unless implementation proves multi-recording is safe.
- Recording state survives CLI invocations through session state.
- Stopping/closing a page should finalize or mark recording failed.
- Reports directory needs retention and cleanup controls.

## Permissions/Guardrails Implications

- Screencast recording is `moderate` risk because it captures sensitive page content.
- Recording authenticated pages should require policy awareness.
- Debug receipt export follows debug bundle policy.
- Recording paths must be safe against traversal.

## Failure/Recovery Behavior

- If screencast start fails, automation continues unless user explicitly required recording.
- If stop fails, return partial artifact metadata and mark receipt failed.
- If browser disconnects mid-recording, finalize what exists and include disconnection cause.
- If artifact write fails, return clear storage error and do not claim recording success.

## CLI/API/MCP Implications

- CLI: `bc browser screencast start [--path <file>] [--show-actions]`
- CLI: `bc browser screencast stop`
- CLI: `bc browser screencast status`
- CLI: `bc debug receipt <taskId>`
- MCP: `bc_browser_screencast_start`
- MCP: `bc_browser_screencast_stop`
- MCP: `bc_browser_screencast_status`
- API: `bc.browser.screencast.start()`, `bc.browser.screencast.stop()`

## Browser/Terminal/FileSystem Path Implications

- Browser path owns video capture and visual annotations.
- Filesystem path stores artifacts and enforces safe report paths.
- Terminal path can later contribute terminal recordings or terminal timeline events.

## Dependencies on Other Sections

- **Depends on:** Section 10 (Self-Debugging and Observability)
- **Depends on:** Section 18 (Security, Privacy, and Policy Hardening)
- **Depends on:** Section 21 (End-to-End Reliability and Golden Workflows)
- **Supports:** Pro dashboard, automation marketplace evidence, customer support, and self-healing analysis.

## Risks/Tradeoffs

- **Risk:** Video files become large. Mitigation: opt-in recording, retention policy, size limits.
- **Risk:** Sensitive data is recorded. Mitigation: policy checks, warnings, redaction/retention controls.
- **Risk:** Screencast API support differs by browser/version. Mitigation: adapter layer and graceful fallback to screenshots.
- **Tradeoff:** Recording adds overhead. Accepted for debug/premium workflows, not default every action.

## Open Questions

- Should successful workflows delete video by default unless `--keep` is set? Recommendation: yes for privacy and disk health.

## Implementation Tracking

- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Adopt Playwright core API through Browser Control adapters.**

**Upstream sources:**
- **microsoft/playwright 1.59+** — `page.screencast`, action annotations, overlays, real-time frames.
- **microsoft/playwright-cli v0.1.9** — visual/action receipt UX.

**What to reuse:**
- Playwright core screencast primitives.
- Action annotation concept and placement options.
- Video receipt idea for agentic workflows.

**What NOT to reuse:**
- Do not make Playwright's test runner the runtime.
- Do not require users to know Playwright APIs.
- Do not bypass Browser Control debug bundle, policy, or path safety.

## Implementation Success Criteria

- Agent can start/stop a screencast from MCP.
- Browser Control records action timeline alongside video.
- Debug bundle can include screencast path and action receipt.
- Recording failure does not break unrelated automation unless recording was required.
- Windows cleanup leaves no orphan recorder/browser helpers.
