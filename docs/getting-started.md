# Getting Started

Browser Control is a unified automation engine for agents and operators. It exposes terminal, filesystem, system, semantic browser, and low-level CDP tools through one runtime.

## Requirements

Node.js `>=22`.

Chrome is not required for terminal/filesystem-only first run. Missing Chrome or unreachable CDP is reported as degraded browser capability.

## Clean Checkout

```bash
npm ci
npm run build
node cli.js --help
node cli.js setup --non-interactive
node cli.js doctor
node cli.js status --json
```

`bc setup` creates the data home and user config. Runtime data is stored in `~/.browser-control` by default, or in `BROWSER_CONTROL_HOME` when set.

## Isolated First Run

PowerShell:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:TEMP ("browser-control-" + [guid]::NewGuid().ToString())
node cli.js setup --non-interactive --json
node cli.js doctor --json
node cli.js status --json
```

Windows `cmd.exe`:

```cmd
set BROWSER_CONTROL_HOME=%TEMP%\browser-control-%RANDOM%
node cli.js setup --non-interactive --json
node cli.js doctor --json
```

Linux/macOS:

```bash
BC_HOME="$(mktemp -d)"
BROWSER_CONTROL_HOME="$BC_HOME" node cli.js setup --non-interactive --json
BROWSER_CONTROL_HOME="$BC_HOME" node cli.js doctor --json
```

## Packed Package Install

```bash
npm pack
mkdir bc-smoke
cd bc-smoke
npm init -y
npm install ../browser-control-1.0.0.tgz
npx bc --help
npx bc setup --non-interactive
npx bc doctor
npx bc status --json
```

Global install from a local tarball:

```bash
npm install -g ../browser-control-1.0.0.tgz
bc --help
```

## MCP

```bash
bc setup --non-interactive
bc mcp serve
```

Use this MCP client snippet:

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

## Browser Workflows

For browser workflows, use managed browser mode or attach to an existing Chrome debug session. If Chrome is missing, terminal and filesystem commands still work. Install Chrome or set `BROWSER_CHROME_PATH` when browser automation is needed.
