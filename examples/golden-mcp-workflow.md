# Golden MCP Workflow

Run only the MCP golden workflow:

```bash
npm run test:e2e:mcp
```

Run all golden workflows:

```bash
npm run test:e2e
```

The MCP workflow starts `bc mcp serve` over stdio, verifies startup stdout is clean, calls status/session/filesystem/terminal tools through the MCP protocol, checks a controlled safe-policy denial, then terminates the MCP process.
