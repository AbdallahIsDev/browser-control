# Troubleshooting

Start with:

```bash
bc doctor
bc status
```

Use `--json` for scripts:

```bash
bc doctor --json
bc status --json
bc config list --json
```

Common fixes:

- Data home is not writable: set `BROWSER_CONTROL_HOME` to a writable directory.
- Chrome is missing: install Google Chrome or set `BROWSER_CHROME_PATH`. Terminal and filesystem commands still work.
- CDP is not reachable: start Chrome with the configured debug port or set `BROWSER_DEBUG_URL` / `browserDebugUrl`.
- Shell is unavailable: set `terminalShell` to `powershell`, `pwsh`, `bash`, or `sh`.
- Daemon is stopped: run `bc daemon start`.
- Provider is invalid: switch back to the local provider.
- CAPTCHA or OpenRouter is partially configured: set the matching API key or remove the provider setting.
- Installed `bc` cannot find compiled files: reinstall from a package that includes `dist/`, or rebuild and rerun `npm pack`.
- Wrong Node version: install Node.js `>=22`.

First-run checks:

```bash
bc setup --non-interactive
bc doctor --json
bc status --json
```

PowerShell isolated data home:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:TEMP ("browser-control-" + [guid]::NewGuid().ToString())
bc setup --non-interactive --json
```

Runtime data lives in `~/.browser-control` by default:

```text
~/.browser-control/
  config.json
  memory.sqlite
  logs/
  reports/
  .interop/
  services/
  skills/
```

