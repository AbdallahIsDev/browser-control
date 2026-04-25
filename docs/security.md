# Security

Browser Control is local-machine automation. Treat it like a tool that can use the same authority as the user account running it.

## Trust Boundaries

- CLI/API/MCP caller to Browser Control runtime.
- Browser Control runtime to local shell/filesystem/browser.
- Browser Control runtime to remote browser providers.
- Browser pages and retrieved content to AI agent instructions.
- Debug/log evidence to local storage.

## Policy Profiles

Built-in profiles:

- `safe`: denies high and critical risk actions.
- `balanced`: default; requires confirmation for high and critical risk actions.
- `trusted`: audits high risk actions and requires confirmation for critical risk actions.

Set profile:

```powershell
bc config set policyProfile balanced
```

Use `safe` for untrusted agents. Use `trusted` only for trusted local workflows.

## Risk Areas

Command path:

- terminal commands can read files, start processes, exfiltrate data, or modify the machine
- one-shot and persistent terminals both need policy controls

Filesystem path:

- reads can expose secrets
- writes/moves/deletes can corrupt data
- recursive delete is high risk

Browser path:

- browser pages may contain authenticated sessions
- cookies/storage/auth snapshots are sensitive
- CDP exposes strong browser control

Low-level path:

- CDP, DOM, network, cookie, coordinate, and script-level operations can bypass semantic safeguards
- docs do not claim native desktop GUI automation outside Chromium/CDP

## MCP Security Model

MCP tools expose local automation to an agent. Only connect trusted clients.

Recommendations:

- start agent sessions with `bc_status`
- use `safe` or `balanced` policy
- scope working directories
- avoid storing provider/API tokens in prompts
- review terminal and filesystem actions before allowing broad agent autonomy
- keep MCP server stdio clean; logs must not pollute stdout

## Secrets and Logs

Config list/get output redacts sensitive keys:

- `BROWSERLESS_API_KEY`
- `CAPTCHA_API_KEY`
- `OPENROUTER_API_KEY`

This redaction is not a global secrecy guarantee. Logs, MCP error strings, debug bundles, console entries, network entries, reports, terminal output, and screenshots can still contain private data from the browser, terminal, filesystem, or command errors. Store and share them carefully.

Runtime data is local:

```text
~/.browser-control/
```

## Provider Tokens

Remote provider configuration can include endpoint URLs and API keys. Provider registry data lives under the Browser Control data home. Local administrators and processes with filesystem access can read local secrets.

## Safe Usage

- use a dedicated browser profile for automation
- avoid using everyday personal Chrome profile for CDP automation
- prefer loopback CDP bind addresses unless WSL/remote access needs more
- use separate `BROWSER_CONTROL_HOME` values for experiments
- keep destructive filesystem actions inside a project workspace
- run `bc doctor` before handing control to an agent
