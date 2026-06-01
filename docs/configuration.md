# Configuration

Browser Control reads built-in defaults, user config, and environment variables. Environment variables override user config.

User config path:

```text
~/.browser-control/config/config.json
```

Override data home:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:USERPROFILE ".browser-control-dev"
```

Browser Control refuses unsafe data-home paths such as your home directory, drive roots, visible user folders, and the repo root. For one-off recovery or controlled CI cases, set `BROWSER_CONTROL_ALLOW_UNSAFE_DATA_HOME=1` to bypass this guard. This is an unsafe escape hatch: prefer an isolated `BROWSER_CONTROL_HOME`, and never point production runs at folders that contain unrelated personal or source data.

## Inspect and Set

```powershell
bc config list
bc config list --json
bc config get policyProfile
bc config set policyProfile balanced
```

Sensitive values are redacted in config output.

## Runtime Paths

```text
~/.browser-control/
  automations/
  browser/downloads/
  browser/profiles/
  config/config.json
  evidence/
  helpers/
  interop/
  logs/
  memory/
  packages/installed/
  packages/drafts/
  policy/
  reports/
  runtime/
  secrets/
  state/
  workflows/
  legacy/
```

Use `bc data doctor --json` to inspect this layout. `bc data cleanup` is dry-run by default and only targets retention-safe runtime temp files. The `legacy/` directory is preserved for manual review and export; cleanup does not move or delete user data from legacy folders.

## Main Config Keys

| Key | Env | Default |
|---|---|---|
| `dataHome` | `BROWSER_CONTROL_HOME` | `~/.browser-control` |
| `brokerPort` | `BROKER_PORT` | `7788` |
| `chromeDebugPort` | `BROWSER_DEBUG_PORT` | `9222` |
| `chromeBindAddress` | `BROWSER_BIND_ADDRESS` | `127.0.0.1` |
| `chromePath` | `BROWSER_CHROME_PATH` | unset |
| `browserDebugUrl` | `BROWSER_DEBUG_URL` | unset |
| Debug file override gate | `BROWSER_ALLOW_DEBUG_FILE_READS` | `0` |
| `browserMode` | `BROWSER_MODE` | `attach` |
| `browserLaunchProfile` | `BROWSER_LAUNCH_PROFILE` | `system` |
| `browserUserDataDir` | `BROWSER_USER_DATA_DIR` | unset |
| `browserUserAgent` | `BROWSER_USER_AGENT` | unset |
| `policyProfile` | `POLICY_PROFILE` | `balanced` |
| `daemonVisible` | `DAEMON_VISIBLE` | `false` |
| `logLevel` | `LOG_LEVEL` | `info` |
| `logFile` | `LOG_FILE` | `false` |
| `terminalShell` | `TERMINAL_SHELL` | auto |
| `terminalCols` | `TERMINAL_COLS` | `80` |
| `terminalRows` | `TERMINAL_ROWS` | `24` |
| `terminalResumePolicy` | `TERMINAL_RESUME_POLICY` | `resume` |
| `terminalAutoResume` | `TERMINAL_AUTO_RESUME` | `true` |
| `browserlessEndpoint` | `BROWSERLESS_ENDPOINT` | unset |
| `browserlessApiKey` | `BROWSERLESS_API_KEY` | unset |
| `captchaProvider` | `CAPTCHA_PROVIDER` | unset |
| `captchaApiKey` | `CAPTCHA_API_KEY` | unset |
| `openrouterModel` | `OPENROUTER_MODEL`, `AI_AGENT_MODEL` | `openai/gpt-4.1-mini` |
| `openrouterBaseUrl` | `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `openrouterApiKey` | `OPENROUTER_API_KEY` | unset |

Additional env-only settings include `BROKER_API_KEY`, `BROKER_SECRET`, `BROKER_ALLOWED_ORIGINS`, `BROKER_ALLOWED_DOMAINS`, `BROKER_RATE_LIMIT_WINDOW_MS`, `BROKER_RATE_LIMIT_MAX_REQUESTS`, `ENABLE_STEALTH`, `STEALTH_LOCALE`, `STEALTH_TIMEZONE_ID`, `STEALTH_FINGERPRINT_SEED`, `STEALTH_WEBGL_VENDOR`, `STEALTH_WEBGL_RENDERER`, `STEALTH_PLATFORM`, `STEALTH_HARDWARE_CONCURRENCY`, `STEALTH_DEVICE_MEMORY`, `PROXY_LIST`, `CAPTCHA_TIMEOUT_MS`, `AI_AGENT_COST_PER_TOKEN`, `STAGEHAND_MODEL`, `RESUME_POLICY`, `MEMORY_ALERT_MB`, `CHROME_TAB_LIMIT`, `TERMINAL_MAX_OUTPUT_BYTES`, `TERMINAL_MAX_SCROLLBACK_LINES`, and `TERMINAL_MAX_SERIALIZED_SESSIONS`.

`BROWSER_DEBUG_RESOLV_CONF` and `BROWSER_DEBUG_ROUTE_TABLE` are advanced WSL troubleshooting overrides. They are ignored unless `BROWSER_ALLOW_DEBUG_FILE_READS=1`, and the referenced files must resolve under `runtime/debug/` inside the Browser Control data home.

## Daemon Visibility

Windows daemon helper windows are hidden by default.

```powershell
bc daemon start
bc daemon start --visible
bc config set daemonVisible false
```

## Browser Providers

```powershell
bc browser provider list
bc browser provider use local
bc browser provider add remote --type custom --endpoint https://browser.example.test
bc browser provider add browserless --type browserless --endpoint https://production-sfo.browserless.io --api-key=$env:BROWSERLESS_API_KEY
```

Provider registry path:

```text
~/.browser-control/providers/registry.json
```

## Proxy Pool

Browser Control can load an optional proxy pool from `PROXY_LIST` or a project-local `proxies.json` file. Keep `proxies.json` local only; it may contain proxy credentials and is ignored by git. Prefer `bc proxy add <url>` for authenticated proxies because the CLI stores credentials in the Browser Control credential vault and writes only sanitized proxy entries. The legacy `bc network proxy add <url>` form remains supported for compatibility.

Example format:

```json
[
  "http://127.0.0.1:8001",
  {
    "url": "http://proxy.example.com:8080",
    "credentialRef": "secret://site/proxy.example.com:8080/proxy-credentials",
    "status": "active"
  }
]
```

## Services

```powershell
bc service register app --port 3000 --protocol http --path /
bc service resolve app
bc service list
```

Service registry path:

```text
~/.browser-control/services/registry.json
```
