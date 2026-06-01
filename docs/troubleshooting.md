# Troubleshooting

Start here:

```powershell
bc doctor
bc status
bc doctor --json
bc status --json
```

## Top 10 Common Issues

### 1. Port 9222 Already in Use

Symptom:

```text
Managed launch failed: Port 9222 is already in use by an existing process.
```

Fix:

```powershell
bc browser attach --port 9222 --yes
```

If the process on `9222` is not the browser you want, close that browser or use
a different debug port:

```powershell
bc browser open https://example.com --port 9223
```

### 2. Cannot Attach to Chrome

Symptoms:

- `CDP port 9222 is not reachable`
- attach tries multiple candidates and fails
- Chrome is visibly open, but Browser Control cannot connect

Chrome cannot add remote debugging to an already-running non-CDP profile. Close
all Chrome windows first, then let Browser Control start the managed browser:

```powershell
bc browser open https://example.com
```

For attach-only mode, start Chrome with remote debugging enabled and then attach:

```powershell
bc config set browserMode attach
bc browser attach --cdp-url http://127.0.0.1:9222 --yes
```

### 3. CDP Port Not Reachable

Symptom:

```text
CDP port 9222 is not reachable from this environment.
```

Fix:

```powershell
bc doctor --json
bc browser state --json
bc browser open https://example.com --json
```

In WSL, use the Windows Chrome bridge documented in `docs/wsl-windows-chrome.md`
instead of assuming `127.0.0.1:9222` points to Windows Chrome.

### 4. Policy Denied or Requires Confirmation

Symptoms:

- `Policy denied`
- `Policy requires confirmation`
- `Rerun with --yes to confirm this high-risk action`

Fix:

```powershell
bc status --json
bc config get policyProfile
```

Use `--yes` only when you understand the action. For untrusted agents, prefer
`safe` or `balanced`. Reserve `trusted` for local operator-controlled
development:

```powershell
bc config set policyProfile balanced
```

### 5. Broker Is Not Reachable

Symptom:

```text
Broker is not reachable at http://127.0.0.1:7788.
```

Fix:

```powershell
bc daemon status
bc daemon start
bc status --json
```

Most browser actions do not require the daemon. Daemon-backed task, schedule,
and broker API commands do.

### 6. Broker Authentication Fails

Symptom:

```text
broker rejected CLI authentication
```

Fix:

```powershell
Remove-Item Env:BROKER_API_KEY -ErrorAction SilentlyContinue
bc daemon stop
bc daemon start
```

If you intentionally set `BROKER_API_KEY`, restart the daemon with the same
value used by the CLI.

### 7. MCP Tool List Hangs or Emits Invalid JSON

Symptoms:

- MCP client reports invalid JSON
- tool list hangs
- stdout contains banners, npm lifecycle text, or logs

Fix:

```json
{
  "command": "bc",
  "args": ["mcp", "serve"]
}
```

Do not start MCP through `npm run` wrappers or scripts that print to stdout.

### 8. Invalid JSON in CLI Flags

Symptoms:

- `Invalid JSON in --params`
- `--steps or --steps-file is required (JSON array of step objects)`
- `--steps must be valid JSON`

Fix:

Prefer files for complex JSON, especially on Windows:

```powershell
bc browser task run --steps-file .\steps.json --json
```

### 9. Target Element Not Found or Stale Ref

Symptoms:

- `Target element not found`
- click/fill works once, then fails after the page updates

Fix:

Refresh state before acting and prefer semantic targets when refs are stale:

```powershell
bc browser snapshot --json
bc browser act click "Submit" --json
```

For modal dialogs or duplicate text, take a fresh snapshot after the modal opens.

### 10. Provider Endpoint Is Not Reachable

Symptom:

```text
Provider endpoint is not reachable
```

Fix:

```powershell
bc browser provider list
bc browser provider health <name>
bc browser provider use local
```

For Browserless/custom providers, verify the endpoint URL, token, firewall, and
TLS certificate before saving or using the provider.

## Chrome or CDP Unavailable

Symptoms:

- browser commands fail
- `bc doctor` reports CDP warnings
- `bc browser status` is disconnected/degraded

Auto-launch (default):

By default, `bc browser open <url>` automatically launches a managed browser if no browser is attachable. No manual launch step is required.

```powershell
bc browser open https://example.com
```

If auto-launch fails, check Chrome installation and try an explicit launch:

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

Disable auto-launch (strict attach-only):

```powershell
bc config set browserAutoLaunch false
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
