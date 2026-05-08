# Section 15: Remote Browser Provider Layer

## Purpose
Browser Control should eventually run both locally and against remote/cloud browser providers. This section defines a provider abstraction so the browser connection can be swapped without changing higher-level agent workflows.

## Why This Section Matters to Browser Control
Local Chrome is the default, but it's not always sufficient. CI/CD pipelines need headless browsers. Parallel agent execution needs multiple browser instances. Cloud deployment needs remote browsers. Region-specific testing needs geographically distributed browsers. A provider abstraction makes these use cases possible without forking the codebase.

## Priority
This is a **later-priority / post-v1 expansion** section. It should not block any mandatory v1 work (Sections 04–13). Implement after local browser automation is solid and battle-tested.

## Scope
- Provider interface abstraction (common connection model above specific providers)
- Provider-specific connection adapters
- Session model that works above any provider
- Provider configuration and selection
- At least one remote provider adapter as proof of concept

## Non-Goals
- Do not make this a v1 blocker
- Do not overfit to one external provider's API
- Do not build our own cloud browser infrastructure
- Do not require remote providers for any core feature

## User-Facing Behavior
- `bc browser provider list` — show available providers (local, browserless, browserbase, etc.)
- `bc browser provider use <name>` — switch active provider
- `bc browser launch --provider browserless` — launch via a specific provider
- Workflow is identical regardless of provider — same commands, same output

## Agent-Facing Behavior
- Agent doesn't need to know which provider is active — the abstraction is transparent
- Agent receives the same session model, same actions, same output contracts regardless of provider
- Agent can work with local and remote browsers in the same workflow (different sessions, different providers)

## Architecture/Design

### Provider Interface
```typescript
interface BrowserProvider {
  name: string;
  capabilities: ProviderCapabilities;

  connect(options?: ConnectOptions): Promise<BrowserConnection>;
  disconnect(connection: BrowserConnection): Promise<void>;
  launch(options?: LaunchOptions): Promise<BrowserConnection>;
  healthCheck(connection: BrowserConnection): Promise<boolean>;
}

interface ProviderCapabilities {
  supportsCDP: boolean;
  supportsLaunch: boolean;
  supportsAttach: boolean;
  supportsProfiles: boolean;
  supportsStealth: boolean;
  maxConcurrentSessions: number;
  regions?: string[];
}
```

### Providers
- **local** — local Chrome/Chromium via CDP (current implementation, default)
- **browserless** — Browserless.io or similar hosted Chrome via WebSocket
- **browserbase** — Browserbase cloud browser platform
- **custom** — user-provided CDP endpoint (any Chrome-compatible remote)

### Session Model
The session model (from Section 5 and Section 8) sits above the provider. A session has a provider reference, but the session's behavior (actions, policy, state) is provider-agnostic.

### Configuration
```typescript
interface ProviderConfig {
  name: string;
  type: "local" | "browserless" | "browserbase" | "custom";
  endpoint?: string;
  apiKey?: string;
  options?: Record<string, unknown>;
}
```

Providers are configured in the data directory (`~/.browser-control/providers.json`) or via environment variables.

### Connection Flow
1. Agent requests a browser session
2. Browser Control checks which provider is active
3. Provider's `connect()` or `launch()` is called
4. Provider returns a `BrowserConnection` (standardized CDP endpoint)
5. All subsequent browser operations use the connection — provider is transparent

## Core Components/Modules
- `providers/interface.ts` — BrowserProvider interface, ProviderCapabilities
- `providers/local.ts` — local Chrome/CDP provider (wraps existing browser_connection.ts)
- `providers/browserless.ts` — Browserless adapter
- `providers/browserbase.ts` — Browserbase adapter
- `providers/custom.ts` — generic remote CDP endpoint adapter
- `providers/registry.ts` — provider registration, selection, health

## Data Models/Interfaces
```typescript
interface ProviderCapabilities {
  supportsCDP: boolean;
  supportsLaunch: boolean;
  supportsAttach: boolean;
  supportsProfiles: boolean;
  supportsStealth: boolean;
  maxConcurrentSessions: number;
  regions?: string[];
}

interface ConnectOptions {
  profile?: string;
  region?: string;
  stealth?: boolean;
  sessionId?: string;
}

interface LaunchOptions {
  profile?: string;
  region?: string;
  stealth?: boolean;
  headless?: boolean;
}
```

## Session/State Implications
- Session model is provider-agnostic — same session works with any provider
- Provider-specific state (e.g., remote session ID) is stored in the session's metadata, not in the core session model
- Session persistence still uses the local data store regardless of provider
- Auth state management (Section 8) may behave differently per provider (some providers have their own auth storage)

## Permissions/Guardrails Implications
- Remote providers introduce network-level considerations (data leaves the machine)
- Connecting to a remote provider: `moderate` risk (sends CDP traffic over network)
- Cloud providers with API keys: key management is `high` risk
- Policy engine applies identically regardless of provider — provider is transparent to policy

## Failure/Recovery Behavior
- If a remote provider is unreachable: clear error with provider name and endpoint
- If a remote session times out: attempt reconnect via provider's health check
- If provider-specific features are not available (e.g., stealth on browserless): fall back gracefully or error clearly
- If provider API key is invalid: clear error on connect, not on first action

## CLI/API/MCP Implications
- CLI: `bc browser provider list/use/add/remove`
- CLI: `bc browser launch --provider <name>`
- MCP: `bc_browser_provider_list`, `bc_browser_provider_use`
- API: `bc.browser.provider.list()`, `bc.browser.provider.use(name)`

## Browser/Terminal/FileSystem Path Implications
- Only the browser path is affected by providers
- Terminal and filesystem paths are always local (no remote terminal provider in v1)
- Low-level fallback tools (CDP, DOM) work identically through any CDP-compatible provider

## Dependencies on Other Sections
- **Depends on:** Section 8 (Browser Sessions) — provider produces the browser connection that sessions use
- **Supports:** Section 5 (Agent Action Surface) — provider is transparent to actions
- **Not blocking:** No section depends on this

## Risks/Tradeoffs
- **Risk:** Provider abstraction leaks (some features only work locally). Mitigation: capabilities object makes limitations explicit, fallback to local for unsupported features.
- **Risk:** Remote providers add latency. Mitigation: document latency tradeoffs, prefer local for latency-sensitive work.
- **Risk:** API key management for cloud providers. Mitigation: store secrets in Browser Control's user-scoped secret/config store or environment injection, not repo-local `.env` as the production default.
- **Tradeoff:** Abstraction adds complexity. Accepted because CI/CD and parallel execution are real needs.

## Open Questions
- Should the provider abstraction cover more than browsers (e.g., remote terminals)? Recommendation: no for v1 — terminal is always local.
- Should we build an internal provider (Browser Control's own cloud browser)? Recommendation: post-v1, if ever.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Wrap external providers, own the abstraction.**

Browser Control should not build cloud browser infrastructure. Provider mechanics should be reused from upstream providers, and Browser Control owns only the provider abstraction interface.

**Upstream sources:**
- **browser-use** (Python) — provider abstraction concept, multi-provider support patterns.
- Provider SDKs (Browserless, Browserbase, etc.) — connection adapters.

**What to reuse:**
- Provider SDK client libraries (direct dependencies where available)
- Connection adapter patterns from browser-use
- Provider capability negotiation patterns

**What NOT to reuse:**
- Do not build cloud browser infrastructure
- Do not import Python provider code — wrap provider SDKs in TypeScript adapters
- Browser Control owns the `BrowserProvider` interface — providers conform to it, not the other way around

**Mixed-language note:** browser-use is Python. Study its provider abstraction concept, then implement the BrowserProvider interface in TypeScript. Provider SDKs may be in any language — use their TypeScript bindings if available, or call their APIs directly.

## Implementation Success Criteria
- Provider can be switched without changing agent workflows
- Browser Control retains one consistent action surface regardless of provider
- At least one remote provider adapter works end-to-end (Browserless or Browserbase)
- Local provider is the default and works identically to current behavior
- Provider capabilities are clearly exposed so agents/tools can adapt to limitations
