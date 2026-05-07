# Web and Desktop Wrapper Spec

## Product Requirements

Browser Control needs full operator visibility and control. The web and Windows desktop wrappers must let an operator observe, run, debug, and configure Browser Control from one dashboard while preserving existing CLI/MCP/API behavior.

The wrappers must use real backend calls. Missing backend capability must appear as an explicit unavailable/capability state, not fake success.

## User Roles and Operator Assumptions

- Local operator: trusted human on same machine.
- AI agent operator: semi-trusted caller using MCP/CLI/API, governed by policy.
- Desktop app renderer: untrusted web surface by default, even when locally packaged.
- Browser pages: attacker-controlled content.
- Local malware/admin: out of scope for prevention; local administrator can read files and process memory.

## Full Feature Scope

- overview dashboard
- browser sessions
- tasks
- automations/schedules
- terminal-in-browser
- filesystem browser/actions
- logs and audit
- debug evidence
- settings/config
- policy/profile view
- MCP/tool status
- health/doctor
- live event stream
- Windows desktop shell
- CLI/script integration
- tests and security review

## Out of Scope

- cloud-hosted multi-user dashboard
- enterprise RBAC/SSO
- remote network exposure by default
- native desktop GUI automation outside Browser Control browser/terminal/filesystem surfaces
- full IDE/editor replacement
- arbitrary frontend plugin JavaScript
- provider token editing in cleartext UI
- claiming OS sandboxing not implemented by Browser Control

## Web App Requirements

- Run locally.
- Default API bind: `127.0.0.1`.
- Require a local auth token for browser-origin requests.
- Use typed API client.
- Subscribe to live events with WebSocket or SSE.
- Show clear loading, empty, error, disconnected, policy-denied, and confirmation-required states.
- Never embed secrets in frontend bundle.
- Provide safe confirmations for destructive actions.

## Windows Desktop App Requirements

- Electron recommended for first implementation.
- Reuse built web UI.
- Start or connect to app-server.
- Generate and pass auth token through preload or URL fragment/session bootstrap without exposing broad Node APIs.
- `contextIsolation: true`, `nodeIntegration: false`, sandbox where practical.
- Lock navigation to local app URL.
- Handle port already in use.
- Stop child process on exit unless persistent daemon selected.
- Document Windows packaging.

## Shared Backend/API Requirements

- Local HTTP server separate from broker if broker contract is insufficient for UI needs.
- API bridge owns UI auth/CORS/CSRF/event replay concerns.
- Backend calls use `createBrowserControl()` and existing runtime modules.
- Every privileged operation routes through policy.
- Response schema maps to `ActionResult`.
- Redact config, logs, debug bundles, network entries, console entries, and terminal output where supported.
- Capability endpoint reports available/unavailable features.

## Terminal-in-Browser Requirements

- Create/list/status/resume/close terminal sessions.
- Execute commands in session or one-shot mode.
- Stream output events.
- Send input.
- Resize if PTY runtime supports it; otherwise return capability unavailable.
- Interrupt/stop session.
- Preserve policy decisions and audit IDs.
- Show confirmation-required before continuing risky commands.
- Use `src/terminal/render.ts` for browser terminal view where possible.

## Logs/Audit Requirements

- Live event stream for runtime events.
- Filter by level, component, session, action, task, and policy decision.
- Include audit event view for privileged actions.
- Redact sensitive values.
- Link logs to task/session/action/debug bundle IDs when present.
- Export/copy only redacted selected entries.

## Task/Automation Requirements

- Create/run task through daemon/broker/task engine.
- List tasks and statuses.
- Cancel/stop only when backend supports it; otherwise unavailable.
- Create/list/pause/resume/delete schedules.
- Run-now if supported by scheduler/task bridge.
- Show next run, last run, run logs, result, and failure debug evidence.

## Browser Session Requirements

- List active browser sessions/pages where available.
- Open URL/service ref.
- Take a11y snapshot.
- Show refs and element roles/names.
- Click/fill/press/type/scroll when policy allows.
- Take screenshots, with annotated screenshot support when backend supports it.
- Show current URL/title.
- Link console/network/debug bundle evidence.

## Filesystem Requirements

- Browse allowed working paths.
- Read files with size limits.
- Write/create only with policy allow or explicit confirmed flow.
- Move/delete only with confirmation when policy requires it.
- Recursive delete requires strong confirmation.
- Permission and policy errors must show exact denied action and risk.

## Policy/Security Requirements

- Bind local server to loopback by default.
- Non-loopback bind requires explicit flag and warning.
- Browser-origin access requires token.
- Protect WebSocket/SSE endpoints.
- Restrict CORS to app origin.
- Add CSRF protection for cookie/session auth if cookies are used; bearer token header is preferred for first implementation.
- Enforce policy on every browser/terminal/fs/config/task/debug action.
- Redact secrets and sensitive debug evidence.
- Audit privileged actions.

## Configuration Requirements

- View effective config entries with redacted values.
- View runtime paths.
- View provider status without token leakage.
- Allow safe config changes through policy.
- Mark restart-required settings.
- Keep config writes through `setUserConfigValue`.

## Packaging/Distribution Requirements

- Keep existing package exports stable.
- Add scripts for web and desktop build/dev.
- Build web assets without requiring desktop.
- Desktop build packages Windows app.
- npm package contents intentional.
- First run can start server and open browser/desktop.

## Testing Requirements

- API route tests.
- Auth/CORS/WebSocket protection tests.
- Policy denial/confirmation tests for terminal/fs/config/browser.
- Terminal stream event schema tests.
- Task/scheduler API tests.
- Web UI build/type tests.
- Desktop security config tests.
- Existing `npm run typecheck`, `npm test`, `npm run build`, `npm run cli -- --help`, `npm run cli -- status`.

## Migration/Backward Compatibility Requirements

- Existing CLI commands continue working.
- Existing MCP tool names and aliases continue working.
- Existing TypeScript package exports continue working.
- Existing runtime data paths remain unchanged.
- New app server is optional; CLI/MCP/API do not require UI.
