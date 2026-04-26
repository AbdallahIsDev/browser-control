# Security

## Security Model Summary

Browser Control is a local automation framework. It can run shell commands, mutate files, control browser tabs, connect to CDP endpoints, preserve auth state, expose MCP tools over stdio, and run a local daemon/broker HTTP API.

The default trust model is local-only: the operator, the local CLI, local TypeScript callers, and locally configured MCP clients are trusted to request powerful actions. Browser Control adds policy routing, risk classification, audit metadata, and redaction, but it is not a sandbox.

## Trust Boundaries

Primary boundaries:

- Local operator to CLI: trusted human boundary.
- TypeScript API caller to Browser Control: trusted in-process code boundary.
- MCP client to MCP stdio server: trusted local agent boundary.
- Broker HTTP client to daemon: local network boundary, authenticated when `BROKER_API_KEY` or `BROKER_SECRET` is configured.
- Browser Control to browser/provider/service: automation boundary with access to browser state, cookies, files, and remote provider credentials.
- Runtime data under `BROWSER_CONTROL_HOME`: local persistence boundary.

Untrusted content includes web pages, terminal output, network events, console logs, captured debug evidence, provider error strings, and any agent-provided tool arguments.

## CLI and Local API

The CLI and TypeScript API are local authority surfaces. They can execute terminal commands, write/delete files, start browsers, attach to authenticated browser sessions, export/import auth state, and edit local config/provider/service state.

Actions exposed through the action surface route through the existing `SessionManager` and policy engine. Direct lower-level TypeScript imports remain trusted code and are not treated as a security boundary.

## MCP Server

MCP runs over stdio. The MCP client connected to `bc mcp serve` is trusted with the tools it invokes. Browser Control keeps MCP protocol stdout clean and routes logs to stderr in stdio mode.

MCP browser, terminal, filesystem, service, provider, and debug tools should use the same action/policy surface as CLI/API operations. Debug bundle, console, and network evidence can contain sensitive page, terminal, and request data, so evidence retrieval is policy-evaluated and redacted.

Do not expose the MCP server to remote clients unless the surrounding transport provides authentication, authorization, logging, and operator controls.

## Daemon and Broker HTTP API

The broker binds to `127.0.0.1` by default. This is intentional: it is a local runtime API, not an internet service.

If `BROKER_API_KEY` is set, it is preferred for broker auth. If absent, `BROKER_SECRET` is accepted for backward compatibility. When an auth key is configured, HTTP and WebSocket requests must provide either `X-API-Key: <key>` or `Authorization: Bearer <key>`.

Config mutation through `/api/v1/config/:key` requires broker auth to be configured and then evaluates the `config_set` policy path before writing. If no broker auth key exists, config mutation fails closed. Some read endpoints can remain unauthenticated in local-only mode; they should not return raw secret config values.

Browser-origin requests are treated differently from same-machine CLI/API calls. If a request has an `Origin` header and no broker auth key is configured, the broker rejects it instead of relying on loopback binding or CORS as an authorization boundary.

Unsafe deployment modes:

- Binding broker to a public interface without auth.
- Publishing broker through a tunnel/proxy without auth and network ACLs.
- Allowing a browser-based web page to call the broker from an unrestricted origin.
- Running daemon under a privileged OS account.

Broker error responses pass through redaction to avoid returning tokenized provider URLs or API keys.

## Browser Profiles and Auth State

Browser profiles and auth snapshots are high-risk. They can contain cookies, localStorage, sessionStorage, and authenticated browser state.

Exporting or importing auth state is governed by high-risk policy paths. Auth snapshots are stored locally under the configured data home when used by persistence flows. Treat that directory like a credential store.

Attaching to a real browser can expose existing tabs, cookies, logged-in accounts, and downloads. Managed browser profiles reduce accidental exposure but still persist automation auth state.

Managed Chrome/CDP launch binds to `127.0.0.1` by default. `BROWSER_BIND_ADDRESS=0.0.0.0` is an explicit interoperability mode and can expose DevTools control to reachable peers.

## Terminal Execution

Terminal actions can execute arbitrary commands in the configured shell. They can read environment variables, write files, start processes, connect to networks, and call local tools.

Terminal open/exec/write/interrupt/close/resume operations are policy-classified. Terminal environment serialization redacts common secret keys such as password, token, API key, auth, cookie, credential, private key, and passphrase. Command metadata is redacted for common token/header patterns. Command stdout/stderr is not blanket-redacted by default because normal command output must remain useful; debug bundle and log storage applies known-pattern redaction.

## Filesystem Operations

Filesystem read/list/stat, write, move, and delete use the structured filesystem layer rather than shell command emulation. Writes, moves, and deletes are classified as high risk. Recursive delete is denied by the safe profile and requires confirmation in balanced/trusted profiles.

Browser Control does not enforce a filesystem sandbox by default. Policy profiles can restrict allowed roots, but OS permissions remain the final authority.

## Debug Bundles and Logs

Debug bundles can contain browser URL/title/snapshot/screenshot metadata, console logs, network failures, terminal output, filesystem paths, exception messages/stacks, policy decisions, and recovery guidance.

Known sensitive values are redacted before debug bundles are returned or saved. Bundle IDs are validated and resolved under the debug bundle directory to prevent path traversal. Logs use the same central redaction helpers for messages and structured data.

Debug bundles and logs can still contain sensitive business data that does not match a known secret pattern. Keep `BROWSER_CONTROL_HOME` private.

## Remote Browser Providers

Remote providers such as Browserless can use tokenized WebSocket/CDP URLs and API keys. Browser Control uses raw provider credentials only transiently for connection attempts and stores/display safe endpoints with sensitive query params stripped or redacted.

Provider connection errors are sanitized before surfacing. Provider registry list output redacts provider tokens and endpoint query secrets. Registry save failures report failure and roll back in-memory changes for security-sensitive provider config.

## Local Service Registry

The service registry maps local names to local URLs for developer ergonomics. Register/remove operations mutate local state and are policy-classified. Listing and resolving services are read-only but can reveal local port names and paths.

Do not treat service names as authorization boundaries. A resolved `bc://name` is only a convenience alias.

## Configuration and Secrets

Sensitive config values include broker auth keys, provider API keys, CAPTCHA keys, OpenRouter keys, tokenized provider URLs, proxy credentials, and auth snapshots.

Config list/get outputs redact known sensitive config values. User config is stored under `BROWSER_CONTROL_HOME/config/config.json` with restrictive permissions where supported by the OS. `.env` files and provider registry files must not be committed with real credentials.

## Safe Deployment

Safe local development mode:

- Keep broker bound to `127.0.0.1`.
- Set `BROKER_API_KEY` before using broker mutation endpoints from any long-running daemon setup.
- Keep `BROWSER_CONTROL_HOME` in a private user directory.
- Use `POLICY_PROFILE=safe` for untrusted agents or exploratory tool use.
- Use `POLICY_PROFILE=balanced` for normal local development.
- Use `POLICY_PROFILE=trusted` only for trusted automation with operator oversight.

## Known Limitations

Browser Control does not sandbox:

- Shell commands or child processes.
- Filesystem access outside policy decisions.
- Browser-rendered web content.
- CDP/Playwright effects once allowed.
- Remote browser provider infrastructure.
- MCP clients connected to stdio.
- OS account permissions.

Redaction is best-effort pattern matching. It reduces known leaks but cannot guarantee removal of all private business data, PII, or novel credential formats.

Dependency audit status for this section: no high or critical findings from `npm audit --audit-level=high`. Moderate transitive findings remain in the Stagehand/LangSmith/uuid dependency chain. `npm audit fix --dry-run` proposed a broad Stagehand/dependency update and still reported the same moderate findings plus peer dependency warnings, so this section defers that churn to a dependency upgrade gate.

Secret scan status for this section: a local high-confidence pattern scan found no GitHub tokens, OpenAI-style `sk-` keys, AWS access keys, or private-key blocks in the worktree outside ignored dependency/build folders. Focused security regression tests pass; the broad `npm test` command is currently environment/timeout sensitive in this worktree and is reported separately from the focused security gate.

## Reporting Security Issues

Report suspected vulnerabilities through the repository issue tracker or the maintainer contact listed in the package metadata. Do not include real tokens, auth snapshots, cookies, or private debug bundles in public reports.
