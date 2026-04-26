# MCP Config Example

Installed or linked package:

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

For source checkouts, run `npm link` first and use the same `bc` config. Avoid `npm run ...` for MCP stdio because npm can print non-protocol text to stdout.

First tool to call:

```json
{
  "tool": "bc_status",
  "arguments": {}
}
```
