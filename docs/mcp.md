# MCP

Browser Control exposes its action surface as an MCP stdio server.

Browser Control exposes short tool aliases such as `status`, `open`, `snapshot`, `click`, `fill`, and `screenshot`. Legacy `bc_*` tool names remain supported.

Some clients prefix tool names with the MCP server name. In those clients, name the server `bc` if you want surfaced names like `mcp_bc_status` and `mcp_bc_open`.

MCP tool inputs are strict. Unknown parameters are rejected before handlers run, for example `expression` on `bc_browser_scroll` fails closed instead of being ignored.

## Start Server

MCP client config:

```json
{
  "mcpServers": {
    "bc": {
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

- `status`
- `bc_status`

Session:

- `bc_session_create`
- `bc_session_list`
- `bc_session_select`
- `bc_session_status`

Browser:

- `open`
- `snapshot`
- `click`
- `fill`
- `screenshot`
- `browser_list`
- `drop`
- `downloads_list`
- `generate_locator`
- `highlight`
- `bc_browser_attach`
- `bc_browser_detach`
- `bc_browser_open`
- `bc_browser_list`
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
- `bc_browser_tab_close`
- `bc_browser_close`
- `bc_browser_downloads_list`
- `bc_browser_drop`
- `bc_browser_generate_locator`
- `bc_browser_highlight`
- `bc_browser_screencast_start`
- `bc_browser_screencast_status`
- `bc_browser_screencast_stop`

Provider:

- `bc_browser_provider_list`
- `bc_browser_provider_use`

Terminal:

- `terminal_open`
- `terminal_exec`
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

- `fs_read`
- `fs_write`
- `fs_list`
- `bc_fs_read`
- `bc_fs_write`
- `bc_fs_list`
- `bc_fs_move`
- `bc_fs_delete`
- `bc_fs_stat`

Debug:

- `debug_health`
- `debug_failure_bundle`
- `bc_debug_health`
- `bc_debug_failure_bundle`
- `bc_debug_get_console`
- `bc_debug_get_network`

Service:

- `bc_service_list`
- `bc_service_resolve`

Workflow:

- `bc_workflow_run`
- `bc_workflow_status`
- `bc_workflow_resume`
- `bc_workflow_approve`
- `bc_workflow_cancel`

Harness:

- `bc_harness_list`
- `bc_harness_find_helper`
- `bc_harness_validate_helper`
- `bc_harness_rollback`

Packages:

- `bc_package_list`
- `bc_package_info`
- `bc_package_run`
- `bc_package_eval`
- `bc_package_grant`

No MCP tools exist for setup, doctor, service register/remove, direct policy editing, raw low-level CDP, task scheduling, or skill management.

`bc_browser_close` closes Browser Control's automation lifecycle. For attached Chrome it detaches the CDP client and returns `closedBrowser:false`; it does not kill the visible user browser. Use `bc_browser_tab_close` to close the current tab.

Browser Control intentionally does not expose an arbitrary JavaScript console/eval MCP tool. Use accessibility actions, snapshots, debug read tools, network/console capture, or registered helpers. Arbitrary JS can read page data and mutate logged-in sessions, so agents must not invent eval tools.

For Browser Control validation, use Browser Control MCP/CLI/API only. Do not fall back to a client built-in browser when validating Browser Control behavior.

Click/fill/hover actions re-check actionability for refs. If a ref points at a custom radio/checkbox whose real input is visually hidden, Browser Control prefers the associated visible `<label>` when one is present. If a stale ref is retried after a DOM update, Browser Control refreshes the snapshot and re-resolves by the previous element's role/name instead of blindly reusing the old ref number. For duplicate text behind modals, semantic text resolution prefers dialog/modal content before background page matches.

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
