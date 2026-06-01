# MCP

Browser Control exposes its action surface as an MCP stdio server.

For terminal-capable agents working in this repo, prefer the CLI first (`bc status --json`, `bc browser state --json`, `bc browser act`, `bc browser task run`). CLI-first execution usually uses fewer LLM tool calls than MCP while preserving the same policy/audit `ActionResult` model. Use MCP Lite for MCP-native clients that need a reduced high-level surface; use full MCP when the full tool set is required.

Browser Control exposes canonical `bc_*` MCP tool names only, such as `bc_status`, `bc_open`, `bc_snapshot`, `bc_act`, and `bc_task_run`.

Some clients prefix tool names with the MCP server name. In those clients, a server named `bc` may surface canonical tools with an extra client-side prefix, for example `mcp_bc_bc_status`.

MCP tool inputs are strict. Unknown parameters are rejected before handlers run, for example `expression` on `bc_scroll` fails closed instead of being ignored.

## Start Server

MCP client config:

```json
{
  "mcpServers": {
    "bc": {
      "command": "bc",
      "args": ["mcp", "serve"]
    }
  }
}
```

For source checkouts, link the package first so MCP can use the clean `bc` entrypoint:

```powershell
npm link
```

Avoid `npm run ...` wrappers for MCP stdio. npm can print lifecycle text to stdout before the protocol starts.

MCP uses stdio. Protocol JSON must be the only normal stdout traffic. Browser Control sets MCP stdio mode before connecting; logs go to stderr.

## Choosing CLI, MCP Lite, or Full MCP

Use this priority for Codex, Hermes-like, OpenCode-like, Gemini CLI, Claude Code, and other command-capable agents:

1. CLI first for repo work and browser automation:
   - `bc status --json`
   - `bc browser state --json`
   - `bc browser act <action> ... --json`
   - `bc browser task run --steps='<json>' --json`
2. MCP Lite when the client is MCP-native or cannot run shell commands.
3. Full MCP when the task needs tools outside Lite mode.

MCP Lite exists to reduce token overhead by exposing high-level tools such as `bc_act` and `bc_task_run` instead of forcing many tiny tool calls. Use `bc_act` with `action:"state"` for compact browser state in Lite mode.

## Security Considerations

MCP runs Browser Control as a local stdio server under the same operating-system
user that starts the MCP client. Treat that client as a privileged local agent:
it can request browser automation, terminal commands, filesystem reads/writes,
debug evidence, workflow/package execution, service resolution, and vault
metadata through the tools exposed below.

### Attack Surface

Depending on the active policy and session, MCP tools can access:

- browser pages, tabs, dialogs, downloads, screenshots, cookies/storage exports
  where policy allows them, and logged-in web sessions visible to the automation
  browser
- terminal sessions and command output
- filesystem paths reachable from the Browser Control process
- debug bundles, captured console/network entries, visual evidence, and runtime
  artifacts under the Browser Control data home
- provider, session, service, package, workflow, and harness state
- credential vault metadata through `bc_vault_list`; raw secret values are not
  returned by that listing tool

Do not point an untrusted MCP client at a sensitive browser profile, broad
working directory, or data home containing secrets unless the policy profile and
OS permissions are intentionally scoped for that client.

### Policy Profiles

All MCP tools route through the same policy/session model as CLI and API calls.
Choose the default profile before connecting the MCP client:

- `safe`: safest choice for untrusted agents. Low-risk actions are allowed,
  moderate-risk actions require confirmation, high and critical actions are
  denied. File upload/download, clipboard, credential submission, raw CDP, JS
  eval, network interception, cookie import/export, and coordinate actions are
  disabled.
- `balanced`: default operator profile. Low-risk actions are allowed,
  moderate-risk actions are audited, and high/critical actions require
  confirmation. Browser upload/download and clipboard are allowed, but
  credential submission, raw CDP, JS eval, network interception, and cookie
  import/export remain disabled.
- `trusted`: development/operator-only profile. Moderate and high-risk actions
  are audited, critical actions still require confirmation, and powerful browser
  capabilities such as raw CDP, JS eval, network interception, cookie
  import/export, credential submission, and automatic dialog acceptance are
  enabled. Do not use `trusted` for untrusted or web-content-driven agents.

Create separate Browser Control sessions for agents with different trust levels
instead of sharing a single privileged session.

### Secrets

Secrets should be stored in the credential vault and referenced through
`secret://...` refs instead of being embedded in MCP prompts, tool arguments, or
client configuration. Vault listings expose ids, scopes, names, timestamps, and
presence flags, not raw secret values.

Credential vault entries use OS-backed protection when available. The local
fallback uses AES-256-GCM with a v2 key descriptor under
`<data-home>/secrets/.vault-key`. Set `BROWSER_CONTROL_VAULT_PASSPHRASE` to
derive the fallback key from an operator-controlled passphrase; without it,
Browser Control stores a random local key for unattended local operation. If
`.vault-key` or `.vault-key.v2` is copied with the vault data, random-file
fallback secrets should be treated as compromised. Never commit, sync, or share
the data home, vault key files, runtime artifacts, screenshots, or debug bundles
unless they have been reviewed for sensitive content.

Logs and evidence are redacted for known secret patterns, but redaction is not a
global secrecy guarantee. Web pages, terminal output, screenshots, console logs,
network records, and exception text can still contain private data.

### Auditing

MCP results preserve policy and failure metadata from the shared `ActionResult`
shape. `policyDecision`, `risk`, `auditId`, `errorCode`, `retryable`,
`suggestedAction`, and safe `errorMetadata` appear when available. Policy audit
JSONL files are written under `<data-home>/reports/policy-audit/` when policy
auditing is enabled. Session and workflow results may also contain audit ids for
confirmation, denied, or audited actions.

For review:

- inspect MCP responses for `policyDecision`, `risk`, `auditId`, `errorCode`,
  `retryable`, and `suggestedAction`
- use `bc status --json` to confirm the active policy profile and data home
- use `bc debug console --json` and `bc debug network --json` only when the
  active policy permits reading captured evidence
- review `<data-home>/reports/policy-audit/` before sharing logs or reports

### Hardening Checklist

- Prefer CLI for command-capable agents and MCP Lite for MCP-native clients that
  only need high-level browser automation.
- Use `safe` or `balanced` for untrusted agents; reserve `trusted` for a local
  operator or a tightly controlled development environment.
- Scope the MCP client's working directory and OS account permissions. Browser
  Control policy is not a full operating-system sandbox.
- Avoid passing API keys or passwords through MCP client environment variables
  unless that client truly needs them.
- Keep MCP server names stable and explicit, for example `bc`, to avoid tool
  confusion when multiple MCP servers are installed.
- Review destructive filesystem, terminal, provider-switching, package,
  workflow, and harness actions before approving them.

## Output Shape

Tools return MCP content containing JSON for the same `ActionResult` shape used by CLI/API:

```json
{
  "success": true,
  "path": "command",
  "sessionId": "system",
  "data": {},
  "completedAt": "2026-04-25T00:00:00.000Z"
}
```

MCP marks failed tool results as errors.
Failed browser actions may include stable codes such as `STALE_REF`,
`BROWSER_TAB_NOT_FOUND`, `DIALOG_BLOCKED`, `BROWSER_DISCONNECTED`, or
`TARGET_RESOLUTION`.

## Tools

Status:

- `bc_status`

Session:

- `bc_session_create`
- `bc_session_list`
- `bc_session_select`
- `bc_session_status`

Browser:

- `bc_attach`
- `bc_detach`
- `bc_launch`
- `bc_open`
- `bc_open_many`
- `bc_navigate`
- `bc_list`
- `bc_snapshot`
- `bc_click`
- `bc_fill`
- `bc_fill_many`
- `bc_hover`
- `bc_type`
- `bc_press`
- `bc_scroll`
- `bc_screenshot`
- `bc_tab_list`
- `bc_tab_switch`
- `bc_tab_close`
- `bc_close`
- `bc_downloads_list`
- `bc_drop`
- `bc_generate_locator`
- `bc_highlight`
- `bc_screencast_start`
- `bc_screencast_status`
- `bc_screencast_stop`
- `bc_paste`
- `bc_provider_catalog`
- `bc_provider_health`
- `bc_dialog`
- `bc_cdp`
- `bc_capture`
- `bc_capture_many`
- `bc_state`
- `bc_act`
- `bc_task_run`

Provider:

- `bc_provider_list`
- `bc_provider_use`

Terminal:

- `bc_terminal_open`
- `bc_terminal_exec`
- `bc_terminal_read`
- `bc_terminal_write`
- `bc_terminal_interrupt`
- `bc_terminal_snapshot`
- `bc_terminal_list`
- `bc_terminal_close`
- `bc_terminal_resume`
- `bc_terminal_status`

Filesystem:

- `bc_fs_read`
- `bc_fs_write`
- `bc_fs_list`
- `bc_fs_move`
- `bc_fs_delete`
- `bc_fs_stat`
- `bc_fs_write_output`

Network:
- `bc_network_rules_list`
- `bc_network_blocked_requests`

Vault:
- `bc_vault_list`

Debug:

- `bc_debug_health`
- `bc_debug_failure_bundle`
- `bc_debug_get_console`
- `bc_debug_get_network`

Service:

- `bc_service_list`
- `bc_service_resolve`

Workflow:

- `bc_workflow_run`
- `bc_workflow_status`
- `bc_workflow_resume`
- `bc_workflow_approve`
- `bc_workflow_cancel`
- `bc_workflow_events`
- `bc_workflow_edit_state`

Harness:

- `bc_harness_list`
- `bc_harness_find_helper`
- `bc_harness_validate_helper`
- `bc_harness_rollback`
- `bc_harness_generate`
- `bc_harness_execute`

Packages:

- `bc_package_install`
- `bc_package_list`
- `bc_package_info`
- `bc_package_update`
- `bc_package_remove`
- `bc_package_run`
- `bc_package_eval`
- `bc_package_grant`
- `bc_package_review`
- `bc_package_review_history`
- `bc_package_eval_history`

No MCP tools exist for setup, doctor, service register/remove, direct policy editing, raw low-level CDP, task scheduling, or skill management.

`bc_close` closes Browser Control's automation lifecycle. For attached Chrome it detaches the CDP client and returns `closedBrowser:false`; it does not kill the visible user browser. Use `bc_tab_close` to close the current tab, or pass `tabId` to close a specific tab.

## Compact Browser State

Use `bc_state` to get current browser state without a full a11y snapshot. Snapshot, screenshot, and downloads must be explicitly requested:

```json
{
  "name": "bc_state",
  "arguments": {
    "snapshot": false,
    "screenshot": false,
    "dialog": true,
    "downloads": false
  }
}
```

Returns `browserConnected`, `url`, `title`, `tabId`, `tabs`, `dialogs`, `warnings`, `status` per section. Downloads default `false` (high risk under balanced policy — opt-in only).

## Unified Action

Use `bc_act` to perform any action and automatically receive compact post-action state. Supports all actions: click, fill, press, hover, scroll, type, paste, screenshot, tab-close, open, navigate, openMany, capture, captureMany, fillMany, state. For `openMany`, pass `parallel:true` only when the tabs are independent and safe to load concurrently.

```json
{
  "name": "bc_act",
  "arguments": {
    "action": "click",
    "target": "@e3",
    "snapshot": false
  }
}
```

Pre-validates required fields per action before dispatch. Full accessibility snapshots are not automatic; call `bc_snapshot` explicitly when you need refs or the full DOM-derived tree.

## Multi-Step Task Runner

Use `bc_task_run` to execute a sequence of actions in one call. Returns per-step results with timing, policy metadata, and compact final state.

```json
{
  "name": "bc_task_run",
  "arguments": {
    "steps": [
      { "action": "open", "url": "https://example.com" },
      { "action": "state" },
      { "action": "writeOutput", "filename": "report.json", "content": "{\"done\":true}", "subdir": "reports" }
    ],
    "continueOnFailure": false
  }
}
```

Each step is validated before execution. Unknown actions, missing required fields, and invalid enum values are caught before any browser action runs.

## Write Output

Use `bc_fs_write_output` to write a file under the active session runtime directory. Rejects absolute paths, path traversal, and symlink escapes. Set `subdir` to `reports`, `screenshots`, or `artifacts` to target those session subdirectories; default is `runtime`.

```json
{
  "name": "bc_fs_write_output",
  "arguments": {
    "filename": "result.json",
    "content": "{\"status\":\"ok\"}",
    "subdir": "artifacts"
  }
}
```

## MCP Lite

Set `BROWSER_CONTROL_MCP_MODE=lite`, run `bc mcp serve --mode=lite`, or pass `{ mode: "lite" }` to expose a reduced toolset focused on browser automation. Lite mode includes the short primary browser tools:

`bc_navigate`, `bc_snapshot`, `bc_act`, `bc_task_run`, `bc_tab_list`, `bc_fs_write_output`, `bc_session_status`, `bc_status`

Full MCP mode exposes the complete Browser Control surface with canonical `bc_*` tool names. Single-action browser tools such as `bc_click`, `bc_fill`, `bc_open`, and `bc_state` are deprecated in full mode because `bc_act` covers the same actions with less tool-schema overhead.

Browser Control intentionally does not expose an arbitrary JavaScript console/eval MCP tool. Use accessibility actions, snapshots, debug read tools, network/console capture, or registered helpers. Arbitrary JS can read page data and mutate logged-in sessions, so agents must not invent eval tools.

For Browser Control validation, use Browser Control MCP/CLI/API only. Do not fall back to a client built-in browser when validating Browser Control behavior.

Click/fill/hover actions re-check actionability for refs. If a ref points at a custom radio/checkbox whose real input is visually hidden, Browser Control prefers the associated visible `<label>` when one is present. If a stale ref is retried after a DOM update, Browser Control refreshes the snapshot and re-resolves by the previous element's role/name instead of blindly reusing the old ref number. For duplicate text behind modals, semantic text resolution prefers dialog/modal content before background page matches.

## Common Inputs

Most browser, filesystem, service, and session tools accept `sessionId` for Browser Control session selection.

Terminal tools distinguish:

- `bc_terminal_open` uses `sessionId` as an optional Browser Control session binding.
- Later terminal tools use `terminalSessionId` for the PTY terminal session returned by `bc_terminal_open`.
- `sessionId` consistently means the Browser Control session for policy/session binding.

Browser targets can be refs such as `@e3`, CSS selectors, or semantic text. Prefer `bc_snapshot` before `bc_act` click or fill actions.

## Security Notes

MCP clients are powerful. Depending on policy, tools can run commands, read/write files, control browser pages with logged-in credentials, and retrieve debug evidence. Use `safe` or `balanced` policy for untrusted agents, scope working directories, and review destructive filesystem or terminal actions.

Provider tools are special: `bc_provider_use` changes the active provider in global provider registry state and is not scoped to one Browser Control session. Treat provider switching as trusted operator configuration.
