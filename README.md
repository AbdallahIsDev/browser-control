# Browser Control

Browser Control is a local automation engine for AI agents and operators. It gives one policy-governed surface for browser pages, terminal sessions, filesystem operations, stable local service URLs, provider-backed browser connections, and debugging evidence.

It is not a native desktop GUI automation product. The browser path targets Chromium/CDP and semantic accessibility snapshots. Native terminal and filesystem operations run on the local machine under the configured policy profile.

## Quick Start

Prerequisite: Node.js `>=22`.

PowerShell:

```powershell
npm install
npm run typecheck
npm run cli -- --help
npm run cli -- setup --non-interactive --profile balanced
npm run cli -- doctor
npm run cli -- status
```

After package installation or `npm link`, use the `bc` command:

```powershell
bc setup --non-interactive --profile balanced
bc doctor
bc status
```

In WSL, run `npm link` from this repo first. If `bc` still resolves to the Linux calculator, install the WSL shim:

```sh
sh scripts/install_wsl_bc.sh
export PATH="$HOME/.local/bin:$PATH"
hash -r
```

Runtime data lives under `%USERPROFILE%\.browser-control` on Windows and `~/.browser-control` on Unix-like systems. Override it with `BROWSER_CONTROL_HOME`.

## First Workflow

PowerShell:

```powershell
bc session create demo --policy balanced
bc term exec "node --version" --json
bc fs ls . --json
```

Browser workflow:

```powershell
bc browser launch --port 9222 --profile default
bc open https://example.com
bc snapshot
bc screenshot
```

Without `--output`, screenshots are saved under the Browser Control runtime screenshots directory.

If Chrome or CDP is unavailable, Browser Control reports degraded browser status. Terminal, filesystem, config, status, and many debug workflows still work.

## Architecture

Browser Control routes actions across three paths:

- `command`: terminal, filesystem, process, service, and local system work.
- `a11y`: browser accessibility snapshots and stable refs such as `@e3`.
- `low_level`: CDP, DOM, network, and browser fallback work.

Every public action returns an `ActionResult` with success/failure state, path, session ID, policy metadata, timestamp, and optional debug bundle information.

Main surfaces:

- CLI: `bc ...`
- TypeScript API: `createBrowserControl()`
- MCP server: `bc mcp serve`
- Broker/daemon runtime for long-lived sessions and scheduled work.

## Docs

- [Getting started](docs/getting-started.md)
- [CLI reference](docs/cli.md)
- [TypeScript API](docs/api.md)
- [MCP setup and tools](docs/mcp.md)
- [WSL + visible Windows Chrome](docs/wsl-windows-chrome.md)
- [Browser behavior](docs/browser.md)
- [Terminal and filesystem behavior](docs/terminal.md)
- [Configuration](docs/configuration.md)
- [Security model](docs/security.md)
- [Source layout](docs/architecture/source-layout.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Support matrix](docs/support-matrix.md)
- [Examples](docs/examples/)

## Limits

- Chromium/CDP browser automation is supported. Other native desktop apps are not supported.
- Browser workflows require local Chrome/Chromium, an attachable CDP endpoint, or a configured remote provider.
- MCP tools can read/write files and run commands depending on policy. Use them only with trusted agents.
- Provider tokens, CAPTCHA keys, and OpenRouter keys are read from config/env and redacted from config output, but local administrators can still access local files and process state.
