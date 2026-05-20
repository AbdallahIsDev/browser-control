# Codex Browser Control Setup

Use Browser Control CLI first for Codex sessions that can run terminal commands. Use MCP Lite when Codex is configured as an MCP client and cannot use the CLI directly.

## CLI-First Commands

```powershell
bc setup --non-interactive --profile balanced
bc status --json
bc browser state --json
bc browser act open --url https://example.com --json
bc browser task run --steps='[{"action":"open","url":"https://example.com"},{"action":"state"}]' --json
```

## MCP Lite Server

```powershell
$env:BROWSER_CONTROL_MCP_MODE = "lite"
bc mcp serve
```

## Expected Behavior

- Agent uses CLI first when shell is available.
- If using MCP, agent starts with `bc_status`, then high-level `bc_browser_state`, `bc_browser_act`, and `bc_task_run`.
- Browser actions use accessibility refs first.
- Terminal and filesystem actions route through policy.
- Full MCP mode is only needed for tools outside Lite mode.

## Security Note

Only connect trusted MCP clients. Browser Control can run local commands and read or write files according to policy.
