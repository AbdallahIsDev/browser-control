# Getting Started

Browser Control runs locally. It can control Chromium through CDP, run terminal commands, read/write files, resolve registered local services, and expose the same action surface through CLI, API, and MCP.

## Prerequisites

- Node.js `>=22`
- npm
- Chrome or Chromium for browser workflows
- PowerShell on Windows, or `bash`/`sh` on Unix-like systems

Install from this source checkout:

```powershell
npm install
npm run typecheck
npm run cli -- --help
```

Use `npm run cli --` in the checkout, or use `bc` after installing/linking the package.

Experimental npm package:

```powershell
npm install -g @abdallahisdev/browser-control
bc --help
```

## First Setup

PowerShell:

```powershell
bc setup --non-interactive --profile balanced
bc doctor
bc status
```

Source checkout equivalent:

```powershell
npm run cli -- setup --non-interactive --profile balanced
npm run cli -- doctor
npm run cli -- status
```

`bc setup` creates the data home and user config. Default data home:

```text
~/.browser-control
```

Override:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:USERPROFILE ".browser-control-dev"
```

## First CLI Workflow

PowerShell:

```powershell
bc session create demo --policy balanced
bc term exec "node --version" --json
bc fs ls . --json
bc status --json
```

`--json` returns machine-readable output for scripts. Human output may include status text.

## First Browser Workflow

Managed browser:

```powershell
bc browser launch --port 9222 --profile default
bc browser open https://example.com --json
bc browser state --snapshot=true --json
bc browser act screenshot --output .\example.png --json
```

Attach to an existing CDP endpoint:

```powershell
bc browser attach --port 9222
bc browser open https://example.com --json
bc browser state --json
```

If Chrome/CDP is missing, browser commands fail or report degraded status. Terminal and filesystem commands do not require Chrome.

## Agent Usage: CLI First

For Codex, Hermes-like agents, OpenCode-like agents, Gemini CLI, Claude Code, and other terminal-capable agents, use Browser Control CLI first. This reduces tool calls and tokens while preserving structured JSON output.

```powershell
bc status --json
bc browser state --json
bc browser act click "@e3" --json
bc browser task run --steps='[{"action":"open","url":"https://example.com"},{"action":"state"}]' --json
```

Use MCP Lite when the agent cannot run CLI directly. Use full MCP only when the task needs the complete MCP tool surface.

## Experimental Operator UI

Normal Browser Control usage is CLI/MCP-first. The local dashboard is an experimental internal operator UI, not the production product surface.

For local operator testing only:

```powershell
bc web serve --open
```

This starts a loopback-only dashboard server in the background, opens a token-authenticated local URL, and exits. For a foreground server that stays attached to the terminal, run:

```powershell
bc web serve --open --wait=true
```

If port `7790` is already in use, fall back to:

```powershell
bc web serve --open --port=0
```

Source checkout equivalents:

```powershell
npm run cli -- web serve --open
npm run cli -- web serve --open --port=0
```

For scripts, prefer CLI/MCP package commands. If testing the experimental dashboard, `bc web serve --open --json` prints machine-readable connection data, including a reachable `url`, tokenized `openUrl`, and background server `pid`. Stop that PID when done. `bc web open` remains as a legacy compatibility alias.

## First Terminal and Filesystem Workflow

PowerShell:

```powershell
bc term open --shell pwsh --cwd .
bc term exec "Get-Location" --json
bc fs write .\tmp\browser-control-demo.txt --content "hello"
bc fs read .\tmp\browser-control-demo.txt
bc fs rm .\tmp\browser-control-demo.txt --force
```

Filesystem delete/move/write operations are riskier than reads and are governed by policy.

## First MCP Workflow

Configure an agent with:

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

Then ask the agent to use MCP Lite high-level tools first: `bc_status`, `bc_act`, and `bc_task_run`. Use `bc_act` with `action:"state"` instead of the full-mode `bc_state` single-action tool. Legacy `bc_browser_*` MCP names remain compatibility aliases, but new integrations should use the shorter `bc_*` names. Use full MCP only when a task needs tools outside Lite mode. Use terminal and filesystem tools only when you trust the agent and policy profile.
