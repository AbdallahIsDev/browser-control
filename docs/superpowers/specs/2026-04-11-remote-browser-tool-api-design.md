# Remote Browser Tool API Design

Date: 2026-04-11
Status: Drafted for review

## Summary

Build a local broker service for `browser-automation-core` that exposes a narrow HTTPS tool API to external AI clients through a free tunnel. The broker connects to the user's existing Chrome debugging session and lets an online AI directly control the browser with bounded tools such as tab discovery, click, fill, read text, screenshot, and key presses.

The external AI remains the planner. The local broker is not an agent and does not interpret tasks. It is a policy-enforcing execution layer that accepts authenticated tool calls, checks them against local safety rules, and executes approved actions through the existing browser core.

## Goals

- Allow external AI clients such as ChatGPT-like online platforms to control the user's already-open Chrome debug session.
- Keep the control model tool-oriented rather than task-oriented.
- Reuse `browser_core.ts` as the browser adapter instead of exposing raw CDP.
- Support both named selectors and raw selectors.
- Protect the logged-in browser session from becoming a remote-control backdoor.
- Work through a free tunnel rather than direct port forwarding.

## Non-Goals

- Exposing raw Chrome DevTools Protocol commands.
- Allowing arbitrary JavaScript execution in the page.
- Building a local AI planner that receives tasks from the remote model.
- Supporting unrestricted website access, unrestricted DOM inspection, or unrestricted data extraction.
- Returning browser secrets such as cookies, local storage, session storage, hidden form fields, or password contents.

## Primary Use Case

1. The user starts Chrome with the existing shared debug session.
2. The user launches the local broker.
3. The user exposes the broker through a free tunnel.
4. An online AI client authenticates to the broker and receives a short-lived capability-scoped session.
5. The online AI uses low-level browser tools to complete work directly against allowlisted sites.
6. The broker enforces policy for every action and records a full audit trail.

## High-Level Architecture

The system has four runtime pieces:

1. **External AI client**
   Sends tool-style HTTPS requests and decides the sequence of actions.

2. **Tunnel endpoint**
   Public HTTPS entrypoint that forwards requests to the local broker without exposing the machine through direct inbound networking.

3. **Local broker**
   Authenticates the caller, validates request payloads, enforces policy, executes browser actions, and records audit logs.

4. **Browser adapter**
   Uses `browser_core.ts` to attach to the existing Chrome debug session and perform approved actions against matching tabs.

## Internal Broker Layers

The broker is split into four layers so the policy boundary stays separate from the browser code:

1. **HTTP layer**
   - Accepts HTTPS JSON requests.
   - Validates schemas.
   - Parses auth headers and request ids.
   - Normalizes responses and error codes.

2. **Policy layer**
   - Enforces session token validity.
   - Applies domain allowlists and path restrictions.
   - Applies per-tool permissions.
   - Applies selector policy for named and raw selectors.
   - Blocks sensitive elements and disallowed surfaces.

3. **Browser adapter layer**
   - Connects through `connectBrowser()`.
   - Finds tabs via URL.
   - Executes approved `click`, `fill`, `readText`, `screenshotElement`, `keyboardFill`, and related operations.
   - Refuses ambiguous write targets.

4. **Audit layer**
   - Writes structured logs for allow, deny, execute, and failure events.
   - Preserves traceability without storing secrets.

## Security Model

The browser may already be logged in to sensitive sites, so the broker must be treated as a privileged boundary.

### Required controls

- API authentication is mandatory even when website login is already present.
- Every remote session must be capability-scoped and short-lived.
- Every request must be checked against an allowlist before touching the browser.
- The broker must fail closed on policy errors, auth errors, and Chrome connectivity failures.

### Session capability fields

Each session includes:

- session id
- signed token
- allowed domains
- allowed tools
- optional allowed named-selector namespaces
- optional raw-selector policy mode
- expiration time
- request budget and rate limit

### Explicitly forbidden capabilities

- raw CDP passthrough
- arbitrary `page.evaluate()` or JavaScript execution
- cookies, localStorage, sessionStorage, indexedDB, or hidden-input extraction
- password-field reads or writes
- browser settings, extension pages, and internal Chrome URLs
- unrestricted file downloads or uploads
- unrestricted navigation outside allowlisted domains

### Sensitive-element blocking

The policy layer must reject actions targeting:

- `input[type=password]`
- hidden inputs
- likely payment, billing, wallet, or checkout flows
- account security pages
- browser or extension management pages
- file chooser flows unless explicitly enabled in a future revision

### Read filtering

`read-text` returns visible text only from allowed elements. It does not return raw HTML, page source, or unrestricted DOM dumps.

## Selector Model

The broker supports two selector modes:

### Named selectors

Named selectors are preferred for stable actions on known sites. They are mapped locally to approved selectors and can be versioned per site.

Examples:

- `adobe.keyword_field`
- `adobe.title_field`
- `adobe.save_button`
- `adobe.red_tile_grid`

### Raw selectors

Raw selectors are supported for flexibility, but only when all of the following are true:

- the domain is allowlisted for raw selectors
- the selector does not match blocked patterns
- the resolved element is not sensitive
- the request tool is allowed for that selector class

Raw selectors should be normalized and logged in a redacted form when needed.

## Connectivity Model

The broker runs locally and is exposed through a free tunnel. The tunnel terminates HTTPS and forwards requests to the broker on the local machine.

Rationale:

- avoids direct public exposure of the machine
- keeps the Chrome debug session local
- allows external AI clients to reach the broker from online platforms
- remains inexpensive and simple to operate

## API Surface

### Session endpoints

- `POST /session/start`
  - input: requested domains, requested tools, optional selector namespaces, ttl
  - output: session id, signed token, granted policy summary

- `POST /session/end`
  - input: active token or session id
  - output: revocation result

- `GET /policy/me`
  - output: granted domains, tools, selector modes, expiry, request budget

### Discovery endpoints

- `GET /tabs`
  - returns only controllable allowlisted tabs

- `POST /tabs/find`
  - input: `url_pattern`
  - output: matching tab id or null

### Action endpoints

- `POST /action/click`
- `POST /action/fill`
- `POST /action/read-text`
- `POST /action/screenshot`
- `POST /action/press-key`
- `POST /action/select-option`

Each action request includes:

- `tab_id`
- either `named_selector` or `raw_selector`
- tool-specific payload such as `value`, `key`, or `commit`

Each action response includes:

- `success`
- result payload if applicable
- normalized target summary
- policy trace id
- structured error code when denied or failed

### Health endpoint

- `GET /health`
  - returns broker health, tunnel reachability summary, and Chrome connection status
  - returns no secrets

## Error Model

All failures should be structured and machine-readable.

Examples:

- `auth_failed`
- `session_expired`
- `tool_not_allowed`
- `domain_not_allowed`
- `selector_blocked`
- `sensitive_element_blocked`
- `tab_not_found`
- `target_not_unique`
- `chrome_unavailable`
- `rate_limited`

The broker must not guess when a write target is ambiguous.

## Execution Rules

- Every write action must resolve exactly one target.
- Every request is authenticated before policy evaluation.
- Policy is evaluated before any browser interaction.
- If a tab disappears mid-session, the client must rediscover it.
- If Chrome is disconnected, all action endpoints fail closed.
- If the broker restarts, prior session tokens are invalidated.

## Audit Logging

The broker records:

- request id
- timestamp
- session id
- client id
- tool name
- domain and tab id
- selector mode
- normalized target summary
- allow or deny outcome
- execution status
- duration

Two log streams are recommended:

- operational log for normal request traces
- security log for auth failures, policy denials, blocked selectors, and suspicious behavior

## Testing Strategy

### Policy tests

- domain allow and deny cases
- token scope enforcement
- token expiry
- blocked selector patterns
- sensitive element blocking
- request budget and rate limiting

### HTTP contract tests

- request schema validation
- auth rejection
- consistent error payloads
- session lifecycle behavior

### Browser adapter tests

- connect to debug Chrome
- list and find tabs by URL
- click wrapper behavior
- fill wrapper behavior
- read text wrapper behavior
- screenshot wrapper behavior
- exact-one-target enforcement

### Live smoke test

Use a harmless allowlisted site and verify:

1. session creation
2. policy readback
3. tab discovery
4. one read-text call
5. one screenshot call
6. one click call
7. one fill call
8. session revocation

## Recommended Implementation Direction

- Implement the broker as a thin remote tool server, not a remote browser shell.
- Reuse the existing `browser_core.ts` helpers where possible.
- Add a policy module that becomes the sole gateway to browser actions.
- Add site-specific named selector registries for stable workflows.
- Keep raw selector support behind stricter checks than named selectors.

## Risks

- Raw selector support increases flexibility but also increases policy complexity.
- A logged-in browser session remains high privilege even with tool restrictions.
- Tunnel exposure increases the importance of correct auth, revocation, and rate limits.
- External AI clients may loop or retry aggressively; request budgets are required.

## Open Decisions Deferred To Planning

- Choice of broker framework
- Choice of token format and signing mechanism
- Concrete tunnel provider setup details
- Storage format for audit logs
- Storage format for named selector registries
- Whether uploads/downloads should ever be supported in a future phase

## Recommendation

Proceed with a broker that exposes a strict, low-level browser tool API over HTTPS via a free tunnel, backed by short-lived capability-scoped sessions and a local policy engine. This gives online AI clients direct operational control while keeping the safety boundary on the user's machine.
