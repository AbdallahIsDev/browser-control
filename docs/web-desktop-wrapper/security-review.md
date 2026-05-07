# Security Review

## Threat Model

### Attackers

- malicious webpage loaded in controlled browser
- untrusted local browser origin trying to call localhost APIs
- semi-trusted AI agent with MCP/tool access
- malicious automation package/spec
- local non-admin process under same user account
- network attacker if user binds server outside loopback

### Crown Jewels

- terminal execution authority
- filesystem read/write/delete authority
- browser cookies/auth state
- provider/API tokens
- debug bundles, screenshots, console/network captures
- config and policy profile state

### Trust Boundaries

- browser UI to local app server
- desktop renderer to Electron main
- app server to Browser Control runtime
- Browser Control runtime to shell/filesystem/browser
- browser page content to automation actions
- debug evidence to UI/export

## Sensitive Operations

- terminal exec/type/interrupt/close
- filesystem write/move/delete/read secrets
- browser credential submission, file drop/upload/download, screenshots
- config mutation
- provider switching and provider token handling
- debug bundle export
- scheduler/task creation that can later execute privileged actions

## Terminal Risks

- command injection through task/action params
- destructive shell commands
- exfiltration through network tools
- secrets printed in output
- persistent sessions keeping sensitive scrollback
- daemon runtime fallback confusion

Mitigations:

- route all terminal actions through policy
- require token-authenticated local API
- redact terminal output where possible before logs/events
- confirmation-required state before high/critical operations
- bounded output sizes and stream backpressure

## Filesystem Risks

- path traversal
- writes outside intended workspace
- recursive delete
- secret reads
- race with symlinks/junctions

Mitigations:

- use `FsActions`, not raw shell
- policy check every fs route
- confirmation for destructive actions
- clear path resolution in response
- future hardening: allowed root scoping and symlink policy tests

## Browser Profile/Session Risks

- CDP controls logged-in browser
- screenshots/debug bundles can capture sensitive data
- malicious page can influence automation choices
- file upload/drop can disclose local files

Mitigations:

- prefer isolated automation profiles
- loopback CDP only
- policy for browser file/drop/credential actions
- redaction and retention labeling for evidence
- no raw JS eval route in dashboard

## Localhost Exposure Risks

- any website can attempt requests to `127.0.0.1`
- CORS alone is not authorization
- non-loopback bind exposes privileged API to LAN

Mitigations:

- bind `127.0.0.1` by default
- token required for browser-origin requests
- non-loopback requires explicit flag and warning
- restrictive CORS to served app origin
- rate limit and body limit

## WebSocket Risks

- unauthorized event subscription leaks logs/evidence
- token leakage in URLs
- replay stale events to wrong client

Mitigations:

- auth before upgrade
- prefer header token; query token only if unavoidable and redacted
- event payload redaction
- bounded replay buffer
- close unauthenticated sockets immediately

## CSRF/CORS Risks

- if cookies are used, CSRF can trigger actions
- wildcard CORS with credentials is unsafe

Mitigations:

- bearer/header token first implementation
- no credentialed wildcard CORS
- origin checks for browser requests
- CSRF token required if cookies/session storage are introduced

## Log Redaction Risks

- env values, tokens, cookies, auth headers, URLs with query secrets
- terminal stdout/stderr with secrets
- network/console captures with credentials

Mitigations:

- reuse `observability/redaction.ts`
- redact backend exceptions
- never return full env
- mark entries as redacted
- add tests for token/query/header redaction in new endpoints

## Secret Handling

- frontend bundle cannot contain secrets
- desktop preload can expose only short-lived app token
- provider tokens are never displayed
- config endpoints return redacted sensitive values

## Policy Enforcement Checks

Each route must have a named policy action. Required tests:

- terminal exec denied/confirmation
- fs delete recursive denied/confirmation
- config set denied/confirmation
- debug bundle export policy
- browser screenshot/file/drop policy
- WebSocket unauthorized rejected

## Required Mitigations Before Release

- loopback-only bind default
- local auth token for browser UI and WebSocket
- CORS/origin restrictions
- policy enforcement route test matrix
- redaction tests
- desktop renderer lockdown tests
- no raw Node API in renderer
- no mock-only privileged buttons
- clear residual-risk docs
