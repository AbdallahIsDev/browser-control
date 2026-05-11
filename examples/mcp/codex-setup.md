# Codex MCP Setup

Use Browser Control as a local MCP server for trusted agent sessions.

## Commands

```powershell
bc setup --non-interactive --profile balanced
bc status --json
bc mcp serve
```

## Expected Behavior

- Agent starts by calling `bc_status`.
- Browser actions use accessibility refs first.
- Terminal and filesystem actions route through policy.

## Security Note

Only connect trusted MCP clients. Browser Control can run local commands and read or write files according to policy.
