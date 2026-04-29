# Section 25: Spatial Snapshot and Visual Confirmation

## Purpose

Agents need fast semantic interaction first, but some sites require geometry. This section extends the a11y/ref layer with bounding boxes, visual highlights, annotations, and stable locator generation so agents can confirm what they are about to click and fall back to coordinates safely when semantic state is incomplete.

## Why This Section Matters to Browser Control

Browser Control already prefers snapshot + refs. Modern agent browser tools are adding spatial metadata and visual confirmation because refs alone are not enough for canvas-heavy apps, games, drag/drop flows, overlays, and unclear hit targets. This section keeps Browser Control competitive with Playwright CLI v0.1.9 while preserving Browser Control's policy, session, MCP, and debug model.

## Scope

- Add optional bounding boxes to browser snapshots.
- Add element highlight overlays for refs, semantic targets, CSS selectors, and coordinates.
- Add annotated screenshots that combine visual state with ref/box labels.
- Add stable locator generation for a snapshot ref where possible.
- Add coordinate-safe fallback metadata for dynamic pages and browser games.
- Add MCP/CLI/API surfaces for boxes, highlights, annotations, and locators.

## Non-Goals

- Do not make coordinate automation the default path.
- Do not replace the existing a11y/ref layer.
- Do not expose raw Playwright internals as the public Browser Control API.
- Do not guarantee generated locators survive every redesign; they are best-effort stable locators.

## User-Facing Behavior

- `bc snapshot --boxes` includes `[box=x,y,width,height]` style geometry in human output and structured bounds in JSON.
- `bc browser highlight @e3` shows a persistent overlay around the target element.
- `bc browser highlight --hide @e3` hides a target overlay.
- `bc screenshot --annotate` saves a screenshot with ref labels and boxes.
- `bc locator @e3` prints a stable locator expression or structured locator candidates.

## Agent-Facing Behavior

- Agent receives bounds with snapshot refs when requested.
- Agent can visually confirm a target before risky click/drag.
- Agent can request an annotated screenshot as evidence for humans.
- Agent can convert a ref into a locator candidate for tests or automation packages.
- Agent can fall back from ref to coordinate only after verifying bounds and viewport.

## Architecture/Design

### Spatial Snapshot

Extend `A11yElement` with viewport-relative bounds:

```typescript
interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor?: number;
}

interface A11yElement {
  ref: string;
  role: string;
  name?: string;
  bounds?: ElementBounds;
}
```

Bounds are optional and requested by flag to keep default snapshots compact.

### Highlight Overlays

Highlights are injected into the page as Browser Control-owned overlay nodes:

- Non-interactive by default (`pointer-events: none`)
- Namespaced attributes (`data-browser-control-highlight`)
- Stable highlight ids for hide/update
- Cleared on navigation/session close
- Never persisted into page storage

### Annotated Screenshots

Annotated screenshot flow:

1. Generate snapshot with boxes.
2. Render lightweight overlay labels for selected refs or visible interactive elements.
3. Capture screenshot.
4. Remove overlay unless persistent highlight was requested.
5. Store screenshot path in reports/debug bundle.

### Locator Generation

Locator generation should produce ordered candidates:

1. Role/name locator when available.
2. Label/placeholder/text locator for inputs and text controls.
3. Test id locator when present.
4. CSS fallback when stable attributes exist.
5. XPath only as last resort and marked brittle.

## Core Components/Modules

- `src/a11y_snapshot.ts` — add optional bounds extraction.
- `src/browser/actions.ts` — highlight, annotate, locator actions.
- `src/mcp/tools/browser.ts` — MCP tools/params for boxes/highlight/locator.
- `src/cli.ts` — CLI flags/commands.
- `src/runtime/reports` or existing report path helpers — annotated screenshot storage.

## Data Models/Interfaces

```typescript
interface HighlightRequest {
  target: string;
  style?: string;
  persist?: boolean;
}

interface LocatorCandidate {
  kind: "role" | "label" | "placeholder" | "text" | "testid" | "css" | "xpath";
  value: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}
```

## Session/State Implications

- Highlight state is page/session-local.
- Highlights clear on navigation unless explicitly re-applied by ref after a fresh snapshot.
- Bounds are valid only for the current viewport and zoom.
- Snapshot cache records whether bounds were included.

## Permissions/Guardrails Implications

- Snapshot boxes are `low` risk.
- Highlighting is `low` risk, but screenshots with annotations may expose sensitive page data and remain `moderate` risk.
- Coordinate clicks derived from boxes keep existing click policy routing.

## Failure/Recovery Behavior

- If bounds cannot be resolved for an element, return the snapshot element without `bounds` and include a warning.
- If overlay injection fails due CSP/frame isolation, fall back to annotated screenshot drawn outside the page if possible.
- If locator generation confidence is low, mark it low and do not present it as stable.
- If ref is stale, request fresh snapshot before generating boxes/highlight/locator.

## CLI/API/MCP Implications

- CLI: `bc snapshot --boxes`
- CLI: `bc browser highlight <target> [--style <css>] [--hide]`
- CLI: `bc screenshot --annotate [--refs e1,e2]`
- CLI: `bc locator <target> [--json]`
- MCP: `bc_browser_snapshot({ boxes: true })`
- MCP: `bc_browser_highlight`
- MCP: `bc_browser_screenshot({ annotate: true })`
- MCP: `bc_browser_generate_locator`
- API: `bc.browser.snapshot({ boxes: true })`, `bc.browser.highlight(target)`, `bc.browser.generateLocator(target)`

## Browser/Terminal/FileSystem Path Implications

- Browser path owns bounds/highlight/locator.
- Terminal path can later expose bounds for browser-rendered terminals.
- Filesystem path stores annotated screenshots and report artifacts.

## Dependencies on Other Sections

- **Depends on:** Section 6 (A11y Snapshot + Ref Layer)
- **Depends on:** Section 8 (Browser Sessions)
- **Depends on:** Section 10 (Observability)
- **Supports:** Section 21 (Golden Workflows)
- **Supports:** future self-healing harness and automation package recording

## Risks/Tradeoffs

- **Risk:** Bounds become stale after layout shifts. Mitigation: pair bounds with snapshot generation time and require re-snapshot after navigation/action.
- **Risk:** Overlay changes page behavior. Mitigation: pointer-events none, isolated namespacing, automatic cleanup.
- **Risk:** Annotated screenshots leak sensitive data. Mitigation: policy routing and redaction options.
- **Tradeoff:** Boxes increase token/output size. Accepted only behind `--boxes`.

## Open Questions

- Should highlighted overlays be visible to users by default during MCP tasks, or only when explicitly requested? Recommendation: explicit request only.

## Implementation Tracking

- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Reimplement in Browser Control using Playwright core APIs; study Playwright CLI behavior.**

**Upstream sources:**
- **microsoft/playwright** — locator APIs, element bounding boxes, screenshots.
- **microsoft/playwright-cli v0.1.9** — `snapshot --boxes`, `highlight`, `show --annotate`, `generate-locator` behavior.

**What to reuse:**
- Conceptual UX and output shape from Playwright CLI.
- Playwright core bounding box and locator primitives.
- Agent-facing idea of explicit visual confirmation before action.

**What NOT to reuse:**
- Do not shell out to Playwright CLI.
- Do not expose Playwright locator syntax as the only Browser Control automation contract.
- Do not bypass Browser Control policy/session/debug layers.

## Implementation Success Criteria

- `bc snapshot --boxes --json` returns refs with viewport-relative bounds.
- Agent can highlight a target, screenshot it, and clear the highlight.
- Annotated screenshots show refs/boxes without breaking page interaction.
- Locator candidates are ordered by stability and confidence.
- Coordinate fallback for games/dynamic apps is safer and easier to verify.
