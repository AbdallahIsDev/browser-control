# Section 7: MCP Integration Layer — Implementation Checklist

- Section: `7 — MCP Integration Layer`
- Spec: `spec.md`
- Status: `implemented and merged`

## Implementation Tasks

- [x] Read `spec.md` and identify the concrete code entry points
- [x] Identify existing files/modules that must be extended
- [x] Add `@modelcontextprotocol/sdk` as explicit dependency in `package.json`
- [x] Create MCP module structure (`mcp/server.ts`, `mcp/types.ts`, `mcp/schema.ts`, `mcp/tool_registry.ts`, `mcp/tools/*.ts`)
- [x] Add shared MCP result/tool helpers (`mcp/types.ts`, `mcp/schema.ts`)
- [x] Implement session tools (`bc_session_create`, `bc_session_list`, `bc_session_select`, `bc_session_status`)
- [x] Implement browser tools (`bc_browser_open`, `bc_browser_snapshot`, `bc_browser_click`, `bc_browser_fill`, `bc_browser_hover`, `bc_browser_type`, `bc_browser_press`, `bc_browser_scroll`, `bc_browser_screenshot`, `bc_browser_tab_list`, `bc_browser_tab_switch`, `bc_browser_close`)
- [x] Implement terminal tools (`bc_terminal_open`, `bc_terminal_exec`, `bc_terminal_read`, `bc_terminal_write`, `bc_terminal_interrupt`, `bc_terminal_snapshot`, `bc_terminal_list`, `bc_terminal_close`)
- [x] Implement filesystem tools (`bc_fs_read`, `bc_fs_write`, `bc_fs_list`, `bc_fs_move`, `bc_fs_delete`, `bc_fs_stat`)
- [x] Implement debug/health tools (`bc_debug_health`)
- [x] Add MCP server bootstrap with stdio transport (`mcp/server.ts`)
- [x] Add `bc mcp serve` CLI command
- [x] Export public MCP surface from `index.ts`
- [x] Add MCP install/usage documentation
- [x] Add tests for MCP layer (tool registration, schema shape, handler routing, session propagation, result formatting, CLI integration)
- [x] Run `npm run typecheck`
- [x] Run `npm test`

## Notes

- The MCP SDK (`@modelcontextprotocol/sdk` v1.29.0) is already resolved in `package-lock.json` but not explicitly listed in `package.json` dependencies. Must add it.
- All MCP tools wrap the existing Section 5 action surface (`BrowserActions`, `TerminalActions`, `FsActions`, `SessionManager`) — no duplication of action logic.
- Session-aware: all tools accept `sessionId` and operate against real Browser Control sessions via `sessionManager.use()`.
- Policy integration: all tools route through `sessionManager.evaluateAction()` — denials and confirmation-required surface clearly in MCP results.
- Debug/health tools are minimal and honest — only `bc_debug_health` is implemented since Section 10 observability is not yet complete.
- Tool names are stable and prefixed with `bc_` to avoid collisions with other MCP servers.

## Orchestrator-Only Completion

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message