# Section 6: Accessibility Snapshot + Ref Layer

## Purpose
Agents should not default to brittle CSS selectors or screenshots when a stable semantic interaction surface is available. This layer provides a compact structural representation of browser pages and browser-rendered terminals, with stable element references that agents use for interaction.

## Why This Section Matters to Browser Control
CSS selectors break when UIs change. Screenshots are expensive and ambiguous. Accessibility snapshots give agents a deterministic, compact, semantic view of the page — the preferred interaction model per product principle #4. Ref-based interaction (`click @e3`) is faster, more reliable, and more LLM-friendly than selector-based interaction.

## Scope
- Accessibility snapshot generation from browser pages
- Stable element refs (e.g., `@e1`, `@e2`) deterministic per snapshot
- Ref-based interaction APIs: click, fill, hover, get text, is visible
- Semantic filters for snapshot output (role, name, state)
- Terminal-compatible a11y snapshots for browser-rendered terminals
- Snapshot diffing: new/removed/renamed elements, state changes, route/title changes
- Fallback chain: ref → semantic query → CSS locator → DOM query → coordinate/screenshot

## Non-Goals
- Do not attempt pixel-perfect vision as the default
- Do not overfit refs to CSS selectors
- Do not make refs globally stable across all time (session-local is sufficient)
- Do not build a full accessibility tree parser for arbitrary native OS apps in v1

## User-Facing Behavior
- `bc snapshot` returns a compact, human-readable list of interactive elements with refs
- `bc click @e3` clicks the element with ref `e3` from the most recent snapshot
- `bc fill @e2 "query"` fills a text input
- Snapshot output is readable by both humans and LLMs

## Agent-Facing Behavior
- Agent calls snapshot, receives structured JSON with ref/role/name/text/state for each element
- Agent uses refs for all interaction — no CSS selectors needed in the common case
- Agent receives diff when page changes: what appeared, what disappeared, what changed state
- Agent can query: "find the submit button" via semantic query without full snapshot

## Architecture/Design

### Snapshot Output Format
```json
[
  { "ref": "e1", "role": "heading", "name": "Dashboard", "level": 1 },
  { "ref": "e2", "role": "textbox", "name": "Search" },
  { "ref": "e3", "role": "button", "name": "Submit", "disabled": false }
]
```

### Ref Semantics
- Deterministic per snapshot (same page state → same refs)
- Short (`e1`, `e2`, `e3`)
- Session-local (refs valid within the current session/page state)
- Invalidated or refreshed when DOM meaningfully changes
- Agent must not assume refs survive navigations unless explicitly stated

### Ref Actions
- `click @e3` — click the element
- `fill @e2 "query"` — type into text input
- `hover @e5` — hover over element
- `get text @e1` — read text content
- `is visible @e7` — check visibility

### Fallback Chain
When the user/agent supplies an action target:
1. ref if present
2. semantic query if present (role + name)
3. CSS locator if present
4. DOM query
5. coordinate / screenshot fallback only when necessary

### Terminal A11y
For browser-rendered terminals, the same snapshot concept applies:
- Terminal content exposed as semantic DOM
- Cursor, prompt, cells, line structure, copyable text available to snapshot layer
- Refs can target lines, prompts, buttons embedded around terminal shells

### Snapshot Diff
Agents need to know whether the page changed. Provide:
- New elements
- Removed elements
- Renamed elements (name changed)
- State changes (disabled, checked, expanded)
- Route/title change

This helps: reduce unnecessary full snapshots, drive retries, detect modal/popover appearance, detect task completion.

## Core Components/Modules
- `a11y_snapshot.ts` — snapshot generation from page accessibility tree
- `ref_store.ts` — ref assignment, lookup, invalidation
- `semantic_query.ts` — query by role/name/state without full snapshot
- `snapshot_diff.ts` — diff two snapshots, report changes

## Data Models/Interfaces
```typescript
interface A11yElement {
  ref: string;
  role: string;
  name?: string;
  text?: string;
  level?: number;
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  focused?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  children?: A11yElement[];
}

interface SnapshotDiff {
  added: A11yElement[];
  removed: A11yElement[];
  renamed: Array<{ ref: string; oldName: string; newName: string }>;
  stateChanged: Array<{ ref: string; changes: Record<string, unknown> }>;
  routeChanged?: { from: string; to: string };
  titleChanged?: { from: string; to: string };
}
```

## Session/State Implications
- Last snapshot is cached per session (for diffing and ref lookup)
- Refs are session-local and page-local
- Navigating to a new page invalidates all refs from the previous page
- Snapshot cache is part of session state and survives across CLI invocations within the same session

## Permissions/Guardrails Implications
- Snapshot generation is `low` risk (read-only)
- Ref-based click on submit/confirm buttons is `high` risk (routed through policy engine)
- Ref-based fill on payment fields is `high` risk
- The snapshot itself may expose sensitive content — consider redaction options for screenshots/snapshots in high-security profiles

## Failure/Recovery Behavior
- If the page has no accessibility tree (some SPAs), fall back to DOM query to construct a synthetic snapshot
- If a ref is stale (element no longer exists), return a clear error with suggestion to re-snapshot
- If snapshot generation times out, return partial results with a timeout warning
- If the browser is disconnected, snapshot returns an error pointing to session reconnection

## CLI/API/MCP Implications
- CLI: `bc snapshot [--role <role>] [--name <name>]` with optional filters
- CLI: `bc click @e3`, `bc fill @e2 "text"` use ref-based targeting
- MCP: `bc_browser_snapshot` tool returns structured JSON
- MCP: `bc_browser_click` accepts ref as parameter
- API: `bc.browser.snapshot()`, `bc.browser.click("@e3")`

## Browser/Terminal/FileSystem Path Implications
- Snapshot is an a11y path operation (not command, not low-level)
- If a11y snapshot fails for a page, the execution router may fall back to low-level (screenshot + coordinate) but only with user/agent awareness
- Terminal a11y snapshots bridge the terminal and browser paths

## Dependencies on Other Sections
- **Depends on:** Section 5 (Agent Action Surface) — snapshot is an action
- **Depends on:** Section 4 (Policy Engine) — ref-based interactions go through policy
- **Supports:** Section 8 (Browser Sessions) — snapshot works with any browser session
- **Supports:** Section 10 (Observability) — snapshots are part of debug bundles
- **Related:** Section 12 (Terminal) — browser-rendered terminal snapshots

## Risks/Tradeoffs
- **Risk:** Accessibility tree varies across sites. Mitigation: fallback chain handles gaps.
- **Risk:** Ref stability across dynamic pages. Mitigation: refs are invalidated on significant DOM changes, agent re-snapshots.
- **Risk:** Snapshot size for large pages. Mitigation: element limits (top N interactive elements), semantic filters, pagination.
- **Tradeoff:** Accessibility-first approach may miss elements without proper ARIA. Accepted — this motivates better web practices and is still better than CSS selectors.

## Open Questions
- Should refs persist across minor DOM changes (e.g., a timer updating) or only major ones? Recommendation: persist unless role/name/interactivity changes.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Vendor/adapt from agent-browser.**

The `snapshot → ref → action` model is the conceptual core of this section, and **agent-browser** has the strongest existing implementation of this pattern.

**Upstream sources:**
- **agent-browser** (TypeScript + Rust) — the snapshot → ref → action model, a11y tree extraction, stable ref assignment, ref-based interaction. This is a prime candidate for vendor/adapt.

**What to reuse:**
- The conceptual model: a11y snapshot → stable refs → ref-based actions
- Ref assignment algorithm (deterministic refs per snapshot)
- Snapshot diffing approach
- Fallback chain concept (ref → semantic → CSS → DOM → coordinate)
- Element filtering and semantic query patterns

**What NOT to reuse:**
- Do not import Rust implementation directly — translate the behavior into TypeScript
- Do not import upstream's browser-only assumption — Browser Control's a11y layer also covers browser-rendered terminals (wterm)
- Do not import upstream's session model — adapt to Browser Control's unified session

**Mixed-language note:** agent-browser has Rust components. Study the Rust code for the a11y tree extraction and ref assignment algorithms. Translate the behavior, not the syntax, into Browser Control TypeScript. Preserve the correctness invariants (refs deterministic per snapshot, refs session-local).

**Terminal a11y:** The terminal a11y snapshot concept (browser-rendered terminals as semantic DOM) should also study **wterm** (https://github.com/vercel-labs/wterm) for how terminal content is exposed as accessible elements.

## Implementation Success Criteria
- Agents can operate mostly via snapshot + refs
- CSS selector usage drops dramatically in agent workflows
- Terminal-like browser surfaces can use the same interaction model
- Snapshots are compact enough to be LLM-friendly (<2K tokens for typical pages)
- Snapshot diff correctly detects modal/popover appearance
- Fallback chain works end-to-end (ref → semantic → CSS → DOM → coordinate)
