# MCP

Browser Control exposes agent tools through MCP.

Minimal MCP server snippet:

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

`bc setup` prints this snippet by default. MCP includes `bc_status` for daemon, broker, provider, terminal, task, service, policy, data-home, and health summary data.

Setup and doctor are intentionally CLI-only because they are human-facing operator workflows.
