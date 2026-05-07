# Getting Started

Browser Control runs locally. It can control Chromium through CDP, run terminal commands, read/write files, resolve registered local services, and expose the same action surface through MCP.

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
bc open https://example.com
bc snapshot
bc screenshot --output .\example.png
```

Attach to an existing CDP endpoint:

```powershell
bc browser attach --port 9222
bc open https://example.com
bc snapshot
```

If Chrome/CDP is missing, browser commands fail or report degraded status. Terminal and filesystem commands do not require Chrome.

## First Dashboard Workflow

Run the local dashboard from a source checkout:

```powershell
npm run cli -- web open --json --port 0
```

The command starts a loopback-only app server, prints machine-readable connection data, and opens a token-authenticated local URL. The dashboard stores the URL fragment token in session storage, then removes the fragment from the address bar. API responses keep ISO UTC timestamps for scripts, while the dashboard formats primary timestamp fields as local human-readable time with timezone.

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

Then ask the agent to call `bc_status` first. Use browser tools after a browser is available; use terminal and filesystem tools only when you trust the agent and policy profile.
