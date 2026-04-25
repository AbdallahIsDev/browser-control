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
- CDP is not reachable: start Chrome with the configured debug port or set `browserDebugUrl`.
- Shell is unavailable: set `terminalShell` to `powershell`, `pwsh`, `bash`, or `sh`.
- Daemon is stopped: run `bc daemon start`.
- Provider is invalid: switch back to the local provider.
- CAPTCHA or OpenRouter is partially configured: set the matching API key or remove the provider setting.

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

