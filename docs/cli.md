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

Preferred sequence:

```powershell
bc status --json
bc browser state --json
bc browser open https://example.com --json
bc browser snapshot --json
bc browser act click "@e3" --capture-on-success --json
bc browser task run --steps='[{"action":"open","url":"https://example.com"},{"action":"state"}]' --json
```

Use MCP Lite when the client cannot run CLI directly. Use full MCP only when the task needs a tool outside the Lite/high-level set.

Experimental local dashboard shortcuts:

```powershell
bc web open
bc web open --json
bc web open --wait=true
bc web open --port=0
npm run cli -- web open
```

`bc web open` starts the experimental loopback operator UI. It is not the main production surface; prefer CLI/MCP package commands for normal agent integration. `--json` prints the reachable `url`, `openUrl`, `token`, and background `pid`; scripts should stop that PID when finished.

## Operator

```text
doctor [--json]
setup [--json] [--non-interactive] [--profile] [--browser-mode] [--chrome-debug-port] [--chrome-bind-address] [--terminal-shell|--shell] [--browserless-endpoint] [--browserless-api-key] [--skip-browser-test] [--skip-terminal-test]
config list|get <key>|set <key> <value> [--json]
status [--json]
```

Useful setup:

```powershell
bc setup --non-interactive --profile balanced
bc doctor --json
bc config list --json
bc config set logLevel debug
```

## Browser Actions

```text
open <url> [--wait-until]
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
close
```

Targets can be accessibility refs such as `@e3`, CSS selectors, or text matches.

## Composite Browser Commands

These commands are the preferred high-level path for agents that need fewer operations.

```text
browser open <url> [--wait-until] [--json]
browser snapshot [--root-selector] [--boxes] [--json]
browser state [--snapshot] [--screenshot] [--downloads] [--dialog] [--tab-id] [--json]
browser act <action> [target] [text] [--text] [--key] [--url] [--urls] [--fields] [--wait-until] [--timeout] [--capture-on-success] [--snapshot] [--screenshot] [--json]
browser task run --steps <json> [--timeout] [--continue-on-failure] [--json]
```

`browser open` and `browser snapshot` are ergonomic aliases for the same browser action surface used by `browser act`.

`browser state` returns compact browser state by default: tabs, active URL/title, dialogs, warnings, and per-section status. Snapshot, screenshot, and downloads are opt-in.

`browser act` supports `click`, `fill`, `press`, `hover`, `scroll`, `type`, `paste`, `screenshot`, `tab-close`, `open`, `navigate`, `openMany`, `capture`, `captureMany`, `fillMany`, and `state`.

For fill, both forms are valid:

```powershell
bc browser act fill searchInput "Amazon" --json
bc browser act fill searchInput --text "Amazon" --json
```

Composite `browser act` and `browser task run` commands use a 30s CLI guard by default. Pass `--timeout <ms>` or `--timeoutMs=<ms>` to lower or raise that guard for one command.

`browser task run` executes multiple steps in one command and returns per-step success, duration, policy metadata, audit id, path, tab id, and final compact state. `writeOutput` steps route through `FsActions.writeOutput`; use `filename` plus `content`, with `target` kept only as a backward-compatible filename alias.

Example:

```powershell
bc browser task run --steps='[
  {"action":"open","url":"https://example.com"},
  {"action":"state","snapshot":true},
  {"action":"writeOutput","filename":"result.json","content":"{\"done\":true}"}
]' --json
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
browser launch [--port] [--profile] [--provider]
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
package run <name> <workflow> [--json]
run --package <name> --workflow <workflow> [--params JSON] [--priority] [--timeoutMs]
schedule <id> --cron "*/5 * * * *" [--name] [--package] [--workflow] [--params JSON]
schedule list
schedule pause <id>
schedule resume <id>
schedule remove <id>
daemon start [--visible]
daemon stop
daemon status [--json]
daemon health [--json]
daemon logs [--json]
```

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
fs ls [path] [--recursive] [--ext]
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
knowledge prune <name-or-domain>
knowledge delete <name-or-domain>
memory stats|clear|get <key>|set <key> <value>
report generate|view
mcp serve
```

Legacy skill, proxy manager, and CAPTCHA commands remain internal/compatibility-only and are not part of the public default CLI surface.
