# Section 7: MCP Integration Layer

## Purpose
Browser Control becomes infrastructure — not just a library — when it plugs natively into agent ecosystems. This section delivers a first-party MCP server that exposes browser, terminal, and file/system tools to any MCP-compatible agent (Codex, Hermes, Cursor, Claude Code, Gemini CLI, OpenCloud, custom orchestrators).

## Why This Section Matters to Browser Control
Without MCP, Browser Control requires agents to shell out to a CLI or import a TypeScript library. With MCP, any MCP client gets a clean tool surface with structured schemas, session awareness, and policy enforcement — zero integration work per agent.

## Scope
- Browser Control MCP server implementation
- Stable, versioned tool schemas for browser, terminal, file/system, session, and debug operations
- Session-aware MCP operations (every tool accepts sessionId)
- Policy engine integration (risky tools still honor Section 4)
- Install docs for major agents
- Semantic versioning for MCP surface

## Non-Goals
- Do not implement ACP in v1
- Do not create a custom protocol before delivering MCP well
- Do not make MCP browser-only — terminal and file/system must be first-class
- Do not simply wrap Google's Chrome DevTools MCP and stop there

## User-Facing Behavior
- User adds one MCP server config to their agent (Codex, Hermes, etc.)
- All Browser Control tools become available immediately
- No code, no library imports, no daemon setup for basic usage

## Agent-Facing Behavior
- Agent sees categorized tools: browser, terminal, file/system, session, debug
- Agent calls tools with structured JSON parameters
- Agent receives structured JSON results
- Risky operations return policy decisions in the response
- Agent can work across browser + terminal + filesystem in one session

## Architecture/Design

### Tool Categories
**Browser tools:** `bc_browser_open`, `bc_browser_snapshot`, `bc_browser_click`, `bc_browser_fill`, `bc_browser_press`, `bc_browser_tab_list`, `bc_browser_tab_switch`, `bc_browser_screenshot`, `bc_browser_evaluate`, `bc_browser_wait_for`

**Terminal tools:** `bc_terminal_open`, `bc_terminal_exec`, `bc_terminal_read`, `bc_terminal_write`, `bc_terminal_interrupt`, `bc_terminal_snapshot`

**File/system tools:** `bc_fs_read`, `bc_fs_write`, `bc_fs_list`, `bc_fs_move`, `bc_fs_delete`, `bc_sys_process_list`, `bc_sys_process_kill`, `bc_sys_service_status`

**Session tools:** `bc_session_create`, `bc_session_list`, `bc_session_select`, `bc_session_status`, `bc_session_audit`

**Debug tools:** `bc_debug_get_console`, `bc_debug_get_network`, `bc_debug_record_trace`, `bc_debug_health`, `bc_debug_failure_bundle`

### MCP Tool Design Rules
- Tools are narrow and composable (one action per tool)
- Names are stable (do not rename core tools lightly)
- Results are structured JSON
- Risky tools honor policy engine (return policy decision in response)
- All tools support `sessionId` parameter
- Tool descriptions guide agents toward best-practice usage

### Versioning Strategy
- Semantic versioning for MCP surface
- Add new tools freely
- Do not rename core tools lightly
- Keep legacy aliases for a transition period when renaming is necessary

### Relationship to chrome-devtools-mcp
- Borrow good ideas from their tool structure
- Optionally interoperate with existing Chrome DevTools MCP setups
- Expose Browser Control's own higher-level browser + terminal + file/system model — not just a CDP wrapper

## Core Components/Modules
- `mcp/server.ts` — MCP server implementation (stdio transport)
- `mcp/tools/browser.ts` — browser tool definitions and handlers
- `mcp/tools/terminal.ts` — terminal tool definitions and handlers
- `mcp/tools/fs.ts` — file/system tool definitions and handlers
- `mcp/tools/session.ts` — session tool definitions and handlers
- `mcp/tools/debug.ts` — debug tool definitions and handlers
- `mcp/schema.ts` — tool schema generation and validation

## Data Models/Interfaces
```typescript
interface McpTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (params: Record<string, unknown>, sessionId?: string) => Promise<ActionResult>;
}

interface McpToolCategory {
  prefix: string; // "browser", "terminal", "fs", "session", "debug"
  tools: McpTool[];
}
```

## Session/State Implications
- MCP tools operate within Browser Control sessions
- If no `sessionId` is provided, the tool uses the default or most-recently-used session
- Session creation via MCP creates a real Browser Control session (shared with CLI)
- MCP session state is persistent — tools called hours later can continue within the same session

## Permissions/Guardrails Implications
- All MCP tools route through Section 4's policy engine
- Tool responses include policy decision metadata when applicable
- `require_confirmation` decisions surface to the MCP client as structured prompts
- `deny` decisions return clear error with the policy rule that blocked the action
- MCP server startup validates that a valid policy profile is configured

## Failure/Recovery Behavior
- If the browser is disconnected, browser tools return a reconnectable error
- If the terminal process dies, terminal tools return a session-expired error with suggestion to reopen
- If policy denies an action, the tool returns a structured denial with the rule name
- If the MCP server itself crashes, it should be restartable without losing session state (state is in the data store, not in-memory)

## CLI/API/MCP Implications
- MCP tools map 1:1 to Section 5's API methods
- CLI commands are isomorphic to MCP tools — same parameters, same output
- MCP tool descriptions are auto-generated from the API method JSDoc where possible
- MCP server is started with `bc mcp serve` (or auto-configured by the agent)

## Browser/Terminal/FileSystem Path Implications
- Browser tools use the a11y path by default (snapshot-based interaction)
- Terminal tools use the command path
- File/system tools use the command path
- Low-level fallback is available via `bc_browser_evaluate` and debug tools but flagged as higher risk

## Dependencies on Other Sections
- **Depends on:** Section 4 (Policy Engine) — all tools route through policy
- **Depends on:** Section 5 (Agent Action Surface) — MCP tools wrap the API surface
- **Depends on:** Section 6 (A11y Snapshot) — browser snapshot is an MCP tool
- **Depends on:** Section 12 (Terminal) — terminal tools need a working terminal layer
- **Depended by:** All agent integrations — this is how agents consume Browser Control

## Risks/Tradeoffs
- **Risk:** MCP protocol evolves and breaks compatibility. Mitigation: pin to a stable MCP SDK version, version the tool surface independently.
- **Risk:** Too many tools overwhelm the agent. Mitigation: categorize clearly, provide good descriptions, consider lazy-loading tools by session type.
- **Risk:** MCP stdio transport limits concurrency. Acceptable for v1 — most agents use one Browser Control session at a time.
- **Tradeoff:** MCP adds a transport layer between agent and engine. Accepted because it standardizes integration across 6+ agent ecosystems.

## Open Questions
- Should the MCP server support HTTP/SSE transport in addition to stdio? Recommendation: stdio for v1, HTTP/SSE for post-v1.
- Should tool schemas be auto-generated from the TypeScript API or hand-written? Recommendation: hand-written for v1, auto-generation tooling for post-v1.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Study chrome-devtools-mcp patterns, own the tool model.**

Browser Control should follow MCP patterns already proven upstream, but its own tool model must span browser + terminal + file/system — no upstream MCP server does this.

**Upstream sources:**
- **chrome-devtools-mcp** (TypeScript) — MCP server implementation, tool schema patterns, CDP integration via MCP. Directly relevant.

**What to reuse:**
- MCP server implementation patterns (stdio transport, tool registration, schema definition)
- Tool naming conventions and schema structure
- Error handling patterns for MCP tools

**What NOT to reuse:**
- Do not wrap chrome-devtools-mcp directly — it's browser-only (CDP), while Browser Control spans browser + terminal + file/system
- Do not adopt its tool model wholesale — Browser Control needs a broader model that includes terminal and file/system tools
- Do not limit Browser Control's MCP surface to DevTools concepts

**Mixed-language note:** chrome-devtools-mcp is TypeScript — direct study and adaptation is straightforward. No translation needed.

## Implementation Success Criteria
- Codex/Hermes/OpenCloud can use Browser Control directly via MCP
- Browser Control tools cover browser, terminal, and file/system work
- Setup instructions are clear and tested for at least 3 agent ecosystems
- MCP clients can use one session model across all surfaces
- All tools return structured JSON that agents can parse deterministically
- Policy decisions are transparent in tool responses
