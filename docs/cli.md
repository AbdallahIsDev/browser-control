# CLI Reference

Use `bc <command> [subcommand] [options]`. In this source checkout, use `npm run cli -- <command>`.

Run help:

```powershell
bc --help
```

JSON mode:

- Most action commands support `--json`.
- Action commands return the formatted `ActionResult` shape.
- `doctor --json`, `status --json`, and `config ... --json` return minified JSON.
- `run` and `schedule` print JSON by default; `--json` makes it compact.
- Successful output can be JSON where supported. Failures are stderr text with command-specific prefixes and non-zero exit codes; `--json` does not guarantee JSON-formatted errors.

## CLI-First Agent Usage

For terminal-capable agents such as Codex, Hermes-like agents, OpenCode-like agents, Gemini CLI, and Claude Code, CLI is the preferred Browser Control surface. It reduces tool calls and token use because one command can return compact, structured state for the whole operation.

Each separate `bc browser ...` command is a separate CLI process. It re-loads config, resolves session state, and initializes the broker/browser-control plumbing before executing. Browser state is preserved through the managed CDP/session layer, but batching related actions with `browser act` or `browser task run` avoids repeated startup and synchronization overhead.

Preferred sequence:

```powershell
bc status --json
bc browser state --json
bc browser open https://example.com --json
bc browser snapshot --json
bc browser act click "@e3" --json
bc browser task run --steps-file .\steps.json --json
```

Use MCP Lite when the client cannot run CLI directly. Use full MCP only when the task needs a tool outside the Lite/high-level set.

Experimental local dashboard shortcuts:

```powershell
bc web serve --open
bc web serve --open --json
bc web serve --open --wait=true
bc web serve --open --port=0
npm run cli -- web serve --open
```

`bc web serve --open` starts the experimental loopback operator UI. It is not the main production surface; prefer CLI/MCP package commands for normal agent integration. `--json` prints the reachable `url`, `openUrl`, `token`, and background `pid`; scripts should stop that PID when finished. `bc web open` remains as a legacy compatibility alias.

## Operator

```text
doctor [--json]
setup [--json] [--non-interactive] [--profile] [--browser-mode] [--chrome-debug-port] [--chrome-bind-address] [--terminal-shell|--shell] [--browserless-endpoint] [--browserless-api-key] [--skip-browser-test] [--skip-terminal-test]
config list|get <key>|set <key> <value> [--json]
status [--json]
network rules list|add|remove [--json]
proxy list|add|remove|test [--json]
```

`status` is the full system status command: daemon, broker, browser sessions, terminal sessions, tasks, services, policy, data paths, and health.

Useful setup:

```powershell
bc setup --non-interactive --profile balanced
bc doctor --json
bc config list --json
bc config set logLevel debug
```

## Browser Shortcuts

```text
snapshot [--root-selector]
click <ref-or-target> [--timeout] [--force]
fill <ref-or-target> <text> [--timeout] [--commit]
hover <ref-or-target> [--timeout]
type <text> [--delay]
press <key>
scroll [up|down|left|right] [--amount]
screenshot [--output] [--full-page] [--target]
tab list
tab switch <id>
tab close [--tab-id]
close
```

These are compatibility shortcuts for `bc browser ...`; prefer `bc browser open`,
`bc browser act`, and `bc browser task run` for new automation.

Targets can be accessibility refs such as `@e3`, CSS selectors, or text matches.

## Composite Browser Commands

These commands are the preferred high-level path for agents that need fewer operations.

```text
browser open [url] [--urls <json>] [--same-tab] [--port] [--profile] [--provider] [--wait-until] [--json]
browser snapshot [--root-selector] [--boxes] [--json]
browser state [--snapshot] [--screenshot] [--full-page] [--downloads] [--dialog] [--tab-id] [--json]
browser capture-many --tab-ids <ids>|--urls <json> [--snapshot] [--screenshot] [--json]
browser act <action> [target] [text] [--text] [--key] [--url] [--urls] [--fields] [--wait-until] [--timeout] [--snapshot] [--screenshot] [--json]
browser task run --steps <json>|--steps-file <path> [--timeout] [--continue-on-failure] [--json]
browser tab list [--json]
browser tab switch <id> [--json]
browser tab close [--tab-id] [--json]
browser highlight <target> [--json]
browser drop <target> --file <path>|--data <mime=value> [--json]
browser downloads list [--json]
```

`browser open` is the additive unified entrypoint:

- no URL launches a managed automation browser
- URL opens a new tab
- URL plus `--same-tab` navigates the current or selected tab
- `--urls <json>` opens multiple tabs

`browser open` and `browser snapshot` are ergonomic aliases for the same browser action surface used by `browser act`.

`browser state` returns compact browser state by default: tabs, active URL/title, dialogs, warnings, and per-section status. Snapshot, screenshot, and downloads are opt-in.

`browser capture` remains as a deprecated compatibility alias for `browser state`. New automation should call `browser state` directly.

Successful `browser act` calls automatically include compact post-action state. Use `browser snapshot` explicitly when you need the full accessibility tree.

`browser act` supports `click`, `fill`, `press`, `hover`, `scroll`, `type`, `paste`, `screenshot`, `tab-close`, `open`, `navigate`, `openMany`, `capture`, `captureMany`, `fillMany`, and `state`.

For fill, both forms are valid:

```powershell
bc browser act fill searchInput "Amazon" --json
bc browser act fill searchInput --text "Amazon" --json
```

Composite `browser act` and `browser task run` commands use a 30s CLI guard by default. Pass `--timeout <ms>` or `--timeoutMs=<ms>` to lower or raise that guard for one command.

`browser task run` executes multiple steps in one command and returns per-step success, duration, policy metadata, audit id, path, tab id, and final compact state. `writeOutput` steps route through `FsActions.writeOutput`; use `filename` plus `content`, with `target` kept only as a backward-compatible filename alias.

Prefer `--steps-file <path>` for complex tasks, especially on Windows, to avoid shell-specific JSON quoting.

Example:

```powershell
@'
[
  {"action":"open","url":"https://example.com"},
  {"action":"state","snapshot":true},
  {"action":"writeOutput","filename":"result.json","content":"{\"done\":true}"}
]
'@ | Set-Content -Path .\steps.json

bc browser task run --steps-file .\steps.json --json
```

## Sessions

```text
session list
session create <name> [--policy] [--cwd]
session use <name-or-id>
session status
```

Sessions bind policy, working directory, browser state, terminal state, and audit context.

## Browser Lifecycle and Providers

```text
browser attach [--port] [--cdp-url] [--target-type chrome|chromium|electron] [--provider]
browser status
browser provider list
browser provider use <name>
browser provider add <name> --type browserless|custom --endpoint <url> [--api-key]
browser provider remove <name>
browser profile list
browser profile create <name> [--type shared|isolated|named]
browser profile use <name>
browser profile delete <name>
browser auth export [output?] --live|--stored [--profile]
browser auth import <file> --live|--stored
```

Built-in providers are `local`, `custom`, and `browserless`. `local` is the default when no registry exists.

## Tasks, Schedules, Daemon

```text
package run <name> [workflow] [--json]
run --skill <name> --action <action> [--params JSON] [--priority] [--timeoutMs]
schedule <id> --cron "*/5 * * * *" [--name] [--skill] [--action] [--params JSON]
schedule list
schedule pause <id>
schedule resume <id>
schedule remove <id>
daemon start [--visible]
daemon stop
daemon status [--json]  # daemon-only status; use `bc status` for full system status
daemon health [--json]
daemon logs [--json]
```

`daemon status` is scoped to daemon lifecycle checks and kept for scripts that manage daemon startup/shutdown. Prefer `status` when diagnosing overall product health.

`package run --json` includes `data.savingsTelemetry` when replay metrics are available. The comparison uses the latest discovery recording for the same package name and reports duration, tool-call, and failure deltas.

Windows daemon launches avoid visible helper windows by default. Use `--visible` or `daemonVisible=true` only when you need a console window.

## Terminal

```text
term open [--shell] [--cwd] [--name]
term exec <command> [--session] [--timeout]
term type <text> --session
term read --session [--max-bytes]
term snapshot [--session]
term interrupt --session
term close --session
term list
term resume <id>|--session <id>
term status <id>|--session <id>
```

Example:

```powershell
bc term exec "node --version" --json
```

## Filesystem

```text
fs read <path> [--max-bytes]
fs write <path> [--content] [--create-dirs=false]
fs write-output <filename> <content>
fs ls [path] [--recursive] [--include-hidden] [--ext]
fs move <src> <dst>
fs rm <path> [--recursive] [--force]
fs stat <path>
```

`fs rm --recursive` can delete directory trees. Use policy profiles and scoped working directories for agent use.

## Services

```text
service register <name> --port <port> [--protocol http|https] [--path] [--detect] [--cwd]
service list
service resolve <name>
service remove <name>
```

Services resolve to local URLs such as `http://127.0.0.1:<port><path>`. `bc://name` references are supported by the resolver.

## Debug, Policy, Knowledge, Utilities

```text
debug bundle <id> [--output]
debug console [--session]
debug network [--session]
policy list
policy inspect <name>
policy export <name> [file]
policy import <file>
knowledge list [--kind interaction-skill|domain-skill]
knowledge show <name-or-domain>
knowledge validate [--all]
knowledge prune <name-or-domain>|--max-bytes <n> [--dry-run=false --confirm=DELETE_OLD_KNOWLEDGE]
knowledge stats [--json]
knowledge delete <name-or-domain>
mcp serve [--mode full|lite]
```

Legacy skill, proxy manager, CAPTCHA, report, and memory-store commands remain internal/compatibility-only and are not part of the public default CLI surface.

## Compatibility Browser Commands

These commands remain supported for older scripts but are deprecated for new
automation. Prefer the unified commands shown above so agents use fewer process
starts and receive the same compact state shape across workflows.

### Deprecated: `browser launch`

**Deprecation banner:** compatibility command only. Prefer `browser open` with
no URL to launch a managed automation browser, or `browser attach` to connect to
an existing browser.

```text
browser launch [--port] [--profile] [--provider]
```

### Deprecated: `browser navigate`

**Deprecation banner:** compatibility command only. Prefer `browser open <url>
--same-tab` for same-tab navigation, or `browser act navigate --url <url>` when
the navigation is one step in a larger action flow.

```text
browser navigate <url> [--tab] [--wait-until] [--json]
```

### Deprecated: `browser open-many`

**Deprecation banner:** compatibility command only. Prefer `browser open --urls
<json>` for opening several tabs, or `browser task run` when tab creation is
part of a larger workflow.

```text
browser open-many --urls <json> [--wait-until] [--json]
```

### Deprecated: `browser capture`

**Deprecation banner:** compatibility command only. Prefer `browser state` with
the same opt-in flags for current tab state, snapshots, screenshots, dialogs,
downloads, and tab selection.

```text
browser capture [--snapshot] [--screenshot] [--json]
```
