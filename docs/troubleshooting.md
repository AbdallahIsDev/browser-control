# Troubleshooting

Start here:

```powershell
bc doctor
bc status
bc doctor --json
bc status --json
```

## Chrome or CDP Unavailable

Symptoms:

- browser commands fail
- `bc doctor` reports CDP warnings
- `bc browser status` is disconnected/degraded

Fix:

```powershell
bc browser launch --port 9222 --profile default
bc browser status
```

Attach mode:

```powershell
bc config set browserMode attach
bc config set browserDebugUrl http://127.0.0.1:9222
bc browser attach --cdp-url http://127.0.0.1:9222
```

Terminal and filesystem workflows still work without Chrome.

## Daemon Cannot Start

Check:

```powershell
bc daemon status
bc daemon health --json
bc daemon logs
```

Common causes:

- port `7788` already in use
- data home not writable
- stale pid file in `.interop`
- invalid config value

Use a separate data home for clean testing:

```powershell
$env:BROWSER_CONTROL_HOME = "$env:TEMP\browser-control-debug"
bc daemon start
```

## MCP Stdio Corruption

Symptoms:

- MCP client reports invalid JSON
- tool list hangs
- random log text appears in protocol stream

Fix:

- start with `bc mcp serve`
- do not wrap it in scripts that print banners to stdout
- send diagnostics to stderr only
- run `bc status --json` outside MCP to test runtime health

## Visible Terminal Windows on Windows

Default daemon launch hides helper windows. If windows appear:

```powershell
bc config get daemonVisible
bc config set daemonVisible false
bc daemon stop
bc daemon start
```

Use `bc daemon start --visible` only when debugging.

## Stuck or Leaked Processes

Check status and stop daemon:

```powershell
bc daemon status
bc daemon stop
```

Runtime metadata:

```text
~/.browser-control/.interop/daemon.pid
~/.browser-control/.interop/daemon-status.json
```

If cleanup is manual, verify the process before terminating it. Do not delete unrelated processes by name.

## Terminal PTY Warnings

`node-pty` can fail if native dependencies are not built for the current Node/runtime.

Try:

```powershell
npm install
npm run typecheck
bc doctor
```

Use one-shot `term exec` for simple commands when persistent PTY sessions are not needed.

## Service URL Resolution Fails

Check registry:

```powershell
bc service list
bc service resolve app
```

Register again:

```powershell
bc service register app --port 3000 --protocol http --path /
bc service resolve app
```

Resolution checks local TCP availability. A registered service can still fail if the dev server is not running.

## Provider Configuration Fails

List providers:

```powershell
bc browser provider list
```

Return to local:

```powershell
bc browser provider use local
```

For Browserless/custom providers, verify endpoint URL and token. Tokens are redacted in config output but still stored locally.

## Install or Build Fails

Use Node.js `>=22`.

```powershell
node --version
npm install
npm run typecheck
npm test
```

Full tests can take longer than quick checks because they cover daemon, terminal, broker, and lifecycle behavior.

## Runtime Data

Default:

```text
~/.browser-control/
  config/config.json
  memory.sqlite
  logs/
  reports/
  .interop/
  profiles/
  services/
  providers/
  skills/
  knowledge/
```

Override:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:USERPROFILE ".browser-control-dev"
```
