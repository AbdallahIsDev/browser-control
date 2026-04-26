# MCP

Browser Control exposes agent tools through MCP.

Install/build first:

```bash
npm ci
npm run build
node cli.js setup --non-interactive
node cli.js mcp serve
```

Installed package:

```bash
npx bc setup --non-interactive
npx bc mcp serve
```

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

## Safety

MCP stdio clients are trusted local agents. Do not bridge `bc mcp serve` to remote users unless another layer provides authentication, authorization, logging, and operator review.

MCP tools can control browsers, terminals, files, services, providers, sessions, and debug evidence. Risky tools route through the Browser Control policy/session action surface. Debug bundle, console, and network evidence may contain sensitive browser, terminal, and request data; evidence retrieval is policy-evaluated and redacted for known secret patterns.

In MCP mode, stdout is reserved for protocol frames. Browser Control sends logs to stderr so plain log lines do not corrupt the MCP stream.

MCP stdio reserves stdout for protocol frames. Normal logs go to stderr. If Chrome is missing, MCP can still expose terminal/filesystem/status tools; browser tools report connection failures until Chrome/CDP is configured.

See [security](security.md) for the full trust model.
