# MCP

Browser Control exposes its action surface as an MCP stdio server.

## Start Server

MCP client config:

```json
{
  "mcpServers": {
    "browser-control": {
      "command": "bc",
      "args": ["mcp", "serve"]
    }
  }
}
```

For source checkouts, link the package first so MCP can use the clean `bc` entrypoint:

```powershell
npm link
```

Avoid `npm run ...` wrappers for MCP stdio. npm can print lifecycle text to stdout before the protocol starts.

MCP uses stdio. Protocol JSON must be the only normal stdout traffic. Browser Control sets MCP stdio mode before connecting; logs go to stderr.

## Output Shape

Tools return MCP content containing JSON for the same `ActionResult` shape used by CLI/API:

```json
{
  "success": true,
  "path": "command",
  "sessionId": "system",
  "data": {},
  "completedAt": "2026-04-25T00:00:00.000Z"
}
```

MCP marks failed tool results as errors.

## Tools

Status:

- `bc_status`

Session:

- `bc_session_create`
- `bc_session_list`
- `bc_session_select`
- `bc_session_status`

Browser:

- `bc_browser_open`
- `bc_browser_snapshot`
- `bc_browser_click`
- `bc_browser_fill`
- `bc_browser_hover`
- `bc_browser_type`
- `bc_browser_press`
- `bc_browser_scroll`
- `bc_browser_screenshot`
- `bc_browser_tab_list`
- `bc_browser_tab_switch`
- `bc_browser_close`

Provider:

- `bc_browser_provider_list`
- `bc_browser_provider_use`

Terminal:

- `bc_terminal_open`
- `bc_terminal_exec`
- `bc_terminal_read`
- `bc_terminal_write`
- `bc_terminal_interrupt`
- `bc_terminal_snapshot`
- `bc_terminal_list`
- `bc_terminal_close`
- `bc_terminal_resume`
- `bc_terminal_status`

Filesystem:

- `bc_fs_read`
- `bc_fs_write`
- `bc_fs_list`
- `bc_fs_move`
- `bc_fs_delete`
- `bc_fs_stat`

Debug:

- `bc_debug_health`
- `bc_debug_failure_bundle`
- `bc_debug_get_console`
- `bc_debug_get_network`

Service:

- `bc_service_list`
- `bc_service_resolve`

No MCP tools exist for setup, doctor, service register/remove, direct policy editing, raw low-level CDP, task scheduling, or skill management.

## Common Inputs

Most browser, filesystem, service, and session tools accept `sessionId` for Browser Control session selection.

Terminal tools distinguish:

- `bc_terminal_open` uses `sessionId` as an optional Browser Control session binding.
- Most later terminal tools use `sessionId` as the terminal session ID returned by `bc_terminal_open`.
- `browserControlSessionId`: Browser Control session ID for policy/session binding.

Browser targets can be refs such as `@e3`, CSS selectors, or semantic text. Prefer `bc_browser_snapshot` before `bc_browser_click` or `bc_browser_fill`.

## Security Notes

MCP clients are powerful. Depending on policy, tools can run commands, read/write files, control browser pages with logged-in credentials, and retrieve debug evidence. Use `safe` or `balanced` policy for untrusted agents, scope working directories, and review destructive filesystem or terminal actions.

Provider tools are special: `bc_browser_provider_use` changes the active provider in global provider registry state and is not scoped to one Browser Control session. Treat provider switching as trusted operator configuration.
