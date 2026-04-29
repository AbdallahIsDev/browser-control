# Section 27: Advanced Browser I/O and Attach UX

## Purpose

Real browser automation needs more than click and type. This section adds file/data drop, better upload/download handling, attachable browser discovery, clean detach, and optional cross-browser launch plumbing so Browser Control can handle richer desktop-like web workflows without falling back to raw Playwright CLI.

## Why This Section Matters to Browser Control

Playwright CLI v0.1.9 improved agent ergonomics for drag/drop, attach discovery, detach, JSON output, and daemon cleanup. Browser Control should provide equivalent or better behavior through its own CLI/MCP/API surfaces, with Windows behavior and policy enforcement first-class.

## Scope

- Add file/data drop onto page elements.
- Improve upload/download workflow reporting.
- Discover attachable system browsers running with remote debugging.
- Add clean detach from attached browser without closing user browser.
- Improve channel-named attach sessions (`chrome`, `msedge`, etc.).
- Harden JSON-clean command output for all new browser I/O commands.
- Add optional browser engine/channel launch plumbing where compatible.
- Add tests for no orphan daemon/helper/browser processes after attach/drop/detach flows.

## Non-Goals

- Do not replace Browser Control provider/session model.
- Do not require Playwright CLI as a dependency.
- Do not force cross-browser support into every feature in the first pass.
- Do not close user-owned browsers during detach.

## User-Facing Behavior

- `bc browser list --all` shows attachable Chrome/Edge instances with remote debugging endpoints.
- `bc browser attach --cdp <endpoint>` attaches with explicit target.
- `bc browser detach` detaches without closing the underlying browser.
- `bc browser drop @e3 --file <path>` drops a file onto an element.
- `bc browser drop @e3 --data text/plain=<value>` drops typed clipboard-like data.
- Downloads report final path, size, URL, and failure reason.
- JSON mode stays machine-clean: no logs mixed into stdout JSON.

## Agent-Facing Behavior

- Agent can discover existing browsers before launching new ones.
- Agent can attach to user Chrome/Edge only when explicit target is available.
- Agent can detach safely after a task and leave user's browser open.
- Agent can perform upload/drop workflows without brittle shell hacks.
- Agent receives structured result for files dropped, downloads completed, and detach status.

## Architecture/Design

### Browser Discovery

Discovery should inspect known local debugging endpoints and process/channel metadata where safe:

```typescript
interface AttachableBrowser {
  channel: "chrome" | "msedge" | "chromium" | "unknown";
  endpoint: string;
  pid?: number;
  userDataDir?: string;
  title?: string;
  attached: boolean;
}
```

Discovery must never kill or modify browsers.

### Attach and Detach

Attach requires explicit target:

- CDP endpoint URL
- known channel endpoint from discovery
- configured provider endpoint

Detach semantics:

- Disconnect Browser Control client/session.
- Keep underlying user browser running.
- Clear Browser Control session binding.
- Report whether browser ownership was `managed` or `attached`.

### Drop Data

Drop supports:

- local files
- text/plain
- text/html
- application/json where safe

All paths pass through filesystem policy and path safety checks before use.

### JSON Cleanliness

All commands added here must route logs to stderr or logger sinks, never stdout JSON. MCP stdio must remain protocol-clean.

## Core Components/Modules

- `src/browser/actions.ts` — drop, download, attach/detach action integration.
- `src/browser/connection.ts` — attach/detach state and browser ownership semantics.
- `src/providers/local.ts` — local discovery and channel handling.
- `src/runtime/launch_browser.ts` — launch/channel options and cleanup.
- `src/mcp/tools/browser.ts` — MCP tools.
- `src/cli.ts` — commands and JSON output.
- `tests/unit/browser_connection.test.ts` and browser action tests — targeted coverage.

## Data Models/Interfaces

```typescript
interface BrowserDropRequest {
  target: string;
  files?: string[];
  data?: Array<{ mimeType: string; value: string }>;
}

interface BrowserDetachResult {
  detached: boolean;
  ownership: "managed" | "attached";
  closedBrowser: boolean;
  endpoint?: string;
}

interface DownloadResult {
  url: string;
  suggestedFilename?: string;
  path?: string;
  sizeBytes?: number;
  status: "completed" | "failed" | "canceled";
  error?: string;
}
```

## Session/State Implications

- Browser sessions must track ownership: managed vs attached.
- Detach clears session browser binding but does not delete unrelated session metadata.
- Drop actions are tied to current page/session and action history.
- Downloads are stored in report/download paths with retention metadata.

## Permissions/Guardrails Implications

- File drop is at least `moderate` risk and can be `high` when files leave local machine.
- Data drop may expose sensitive clipboard-like content.
- Attaching to a user browser is `moderate` risk and should be explicit.
- Detach is low risk but must not close user-owned browser.
- Download paths must be safe against traversal and accidental overwrite.

## Failure/Recovery Behavior

- If no attachable browsers are found, return `(no browsers)` style clear empty state.
- If attach target is missing, return a clear error; do not attach implicitly.
- If detach fails, report exact connection state and do not kill browser as fallback.
- If drop target is stale, request a fresh snapshot and retry only if safe.
- If download path cannot be written, cancel or report failure clearly.

## CLI/API/MCP Implications

- CLI: `bc browser list --all`
- CLI: `bc browser attach --cdp <endpoint>`
- CLI: `bc browser detach [--session <id>]`
- CLI: `bc browser drop <target> --file <path>`
- CLI: `bc browser drop <target> --data <mime=value>`
- CLI: `bc browser downloads list`
- MCP: `bc_browser_list({ all: true })`
- MCP: `bc_browser_attach`
- MCP: `bc_browser_detach`
- MCP: `bc_browser_drop`
- API: `bc.browser.list({ all: true })`, `bc.browser.detach()`, `bc.browser.drop()`

## Browser/Terminal/FileSystem Path Implications

- Browser path owns attach/detach/drop/download actions.
- Filesystem path validates local files used in drop/upload and destination download paths.
- Terminal path is not required, except for optional discovery helpers where platform APIs require process inspection.

## Dependencies on Other Sections

- **Depends on:** Section 8 (Real Browser / Profiles / Session UX)
- **Depends on:** Section 15 (Remote Browser Provider Layer)
- **Depends on:** Section 18 (Security, Privacy, and Policy Hardening)
- **Supports:** Section 19 (Install, Packaging, and First-Run Experience)
- **Supports:** Section 21 (End-to-End Reliability and Golden Workflows)

## Risks/Tradeoffs

- **Risk:** Windows browser process discovery is brittle. Mitigation: prefer CDP endpoint probing and clear empty state; keep process inspection best-effort.
- **Risk:** Detach accidentally closes user browser. Mitigation: explicit ownership model and tests.
- **Risk:** File drop can upload sensitive files. Mitigation: policy routing and clear audit entries.
- **Risk:** Cross-browser support expands test matrix. Mitigation: add optional plumbing first, then formalize support after CI coverage.

## Open Questions

- Should cross-browser launch be exposed now or hidden behind experimental flag? Recommendation: experimental flag until Windows/Linux/macOS matrix is stable.

## Implementation Tracking

- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Reimplement in Browser Control; use Playwright core APIs and study Playwright CLI UX.**

**Upstream sources:**
- **microsoft/playwright** — upload/download, browser contexts, CDP attach, channel launch, browser lifecycle.
- **microsoft/playwright-cli v0.1.9** — `drop`, `list --all`, explicit attach target, detach, JSON cleanliness, daemon cleanup fixes.

**What to reuse:**
- User-facing concepts and behavior from Playwright CLI.
- Playwright core primitives for file chooser, drag/drop, downloads, connect/launch.
- Explicit attach and clean detach semantics.

**What NOT to reuse:**
- Do not shell out to Playwright CLI.
- Do not allow bare attach.
- Do not close attached user browsers during detach.
- Do not bypass Browser Control provider, policy, session, and audit layers.

## Implementation Success Criteria

- `bc browser list --all --json` reports attachable browsers or clear empty state.
- Attach requires explicit target and never silently falls back to local launch.
- Detach disconnects Browser Control without closing attached Chrome/Edge.
- File/data drop works through CLI/MCP with policy/audit entries.
- JSON output remains clean under `--json` and MCP stdio remains protocol-clean.
- Windows cleanup tests show no leftover daemon/helper/browser junk from new flows.
