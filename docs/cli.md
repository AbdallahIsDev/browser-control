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
run --skill <name> --action <action> [--params JSON] [--priority] [--timeoutMs]
schedule <id> --cron "*/5 * * * *" [--name] [--skill] [--action] [--params JSON]
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
proxy test|add <url>|remove <url>|list
memory stats|clear|get <key>|set <key> <value>
skill list|health <name>|actions <name>|install <path>|validate <name-or-path>|remove <name>
report generate|view
captcha test
mcp serve
```

`mcp serve` exists for MCP clients but is hidden from the main help output.
