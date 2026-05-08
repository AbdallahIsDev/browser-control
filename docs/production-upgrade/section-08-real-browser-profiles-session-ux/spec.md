# Section 8: Real Browser, Profiles, and Session UX

## Purpose
Most useful automations rely on existing logins, persistent browser identity, and repeatable sessions. This section makes real-world authenticated workflows practical by supporting connection to real Chrome/Chromium/Electron, browser profile reuse, and clear UX around what session the agent is operating in.

## Why This Section Matters to Browser Control
An AI agent that can't log in is useless for real work. Trading platforms, email, admin dashboards, CMS systems — all require authenticated sessions. Browser Control must connect to real browsers with real cookies, not force re-authentication every run.

## Scope
- Connect to existing Chrome/Chromium/Electron via CDP
- Managed automation profile (Browser Control owns the browser)
- Attach to running browser (Browser Control connects to user's existing browser)
- Session restore (rehydrate prior state into managed context)
- Profile modes: shared automation, isolated temp, named persistent
- Auth state persistence: cookies, local storage, session storage
- Clear UX about which profile/session is active
- Electron app support via CDP

## Non-Goals
- Do not overcomplicate with too many browser identity abstractions in v1
- Do not pretend all profile reuse is equally safe
- Do not mix real-user and automation contexts silently
- Do not build a full browser profile manager with sync/import/export in v1

## User-Facing Behavior
- `bc browser attach` connects to the user's running Chrome
- `bc browser launch` starts a dedicated automation browser
- `bc browser profile list` shows available profiles
- `bc browser profile use <name>` switches to a named profile
- User always knows: which browser, which profile, whether cookies persist, whether the agent sees all tabs or only controlled tabs

Browser lifecycle and identity management use the `bc browser ...` namespace, while ordinary browser actions remain top-level:

- `bc open`, `bc snapshot`, `bc click`, `bc fill`, `bc screenshot`
- `bc browser attach`, `bc browser launch`, `bc browser profile ...`, `bc browser auth ...`

## Agent-Facing Behavior
- Agent works within a session that has a browser connection
- Agent doesn't need to know whether the browser is managed or attached — the session abstracts this
- Agent can request a fresh isolated context when needed (e.g., testing a login flow)
- Agent can persist auth state for reuse in future sessions

## Architecture/Design

### Connection Modes
1. **Managed automation profile** — Browser Control launches and owns a dedicated Chrome profile. Logins are fresh unless auth state is explicitly imported.
2. **Attach to running browser** — Browser Control connects to existing Chrome via CDP. The agent sees the user's real tabs, cookies, logins.
3. **Session restore** — Browser Control rehydrates prior state (cookies, local storage) into a managed context.

### Profile Modes
- **Shared automation profile** — persistent across runs, logins survive restarts. Default for skill-based automation.
- **Isolated temp profile** — fresh every session, nothing persists. Default for testing.
- **Named persistent profiles** — user-created profiles for different identities (work, personal, trading).
- **Import/export auth state** — transfer cookies and storage between profiles.

### Session State
Persist: cookies, local storage, session storage (where feasible), tab metadata, preferred connection target, auth snapshots (where policy allows).

### Security Boundaries
- Exporting auth state is `high` risk (route through policy engine)
- Importing auth state is `high` risk
- Connecting to a real browser with existing tabs is `high` risk
- The user must always understand: is this my real browser or an automation browser?

### Electron Support
Electron and Chromium-based apps use the same CDP connection model. Browser Control can attach to Electron apps when CDP is enabled.

## Core Components/Modules
- `browser_connection.ts` — CDP connection management, attach/launch/disconnect
- `browser_profiles.ts` — profile CRUD, isolation, persistence
- `browser_auth_state.ts` — cookie/storage export, import, snapshot
- `browser_electron.ts` — Electron-specific CDP attachment

## Data Models/Interfaces
```typescript
interface BrowserProfile {
  id: string;
  name: string;
  type: "shared" | "isolated" | "named";
  dataDir: string;
  createdAt: string;
  lastUsedAt: string;
}

interface BrowserConnection {
  mode: "managed" | "attached" | "restored";
  profile: BrowserProfile;
  cdpEndpoint: string;
  connectedAt: string;
  tabCount: number;
}

interface AuthSnapshot {
  profileId: string;
  cookies: Cookie[];
  localStorage: Record<string, Record<string, string>>;
  capturedAt: string;
}
```

## Session/State Implications
- Session binds to a browser connection + profile
- Switching profiles mid-session creates a new browser context (not a new session)
- Auth snapshots are stored per-profile in the data store
- Session restore loads auth snapshot into a fresh managed context

## Permissions/Guardrails Implications
- Attach to running browser: `high` risk (agent sees user's real tabs/cookies)
- Export auth state: `high` risk (leaks login credentials as cookies)
- Import auth state: `high` risk (injects credentials into automation browser)
- Manage profiles: `moderate` risk (creates/deletes browser data directories)
- All governed by Section 4's policy engine

## Failure/Recovery Behavior
- If Chrome is not running and user requested attach: error with suggestion to launch Chrome with `--remote-debugging-port` or use `bc browser launch`
- If CDP connection drops mid-session: attempt reconnect via Section 10's watchdog, report degraded status
- If profile data directory is corrupted: suggest creating a new profile, offer to import auth from another profile
- If auth snapshot is expired/stale: warn agent, suggest re-authentication

## CLI/API/MCP Implications
- CLI: `bc browser attach`, `bc browser launch`, `bc browser profile list/use/create/delete`
- CLI: `bc browser auth export <profile>`, `bc browser auth import <file>`
- MCP: `bc_browser_attach`, `bc_browser_launch`, `bc_browser_profile_list`
- API: `bc.browser.attach()`, `bc.browser.launch()`, `bc.browser.profiles.list()`

## Browser/Terminal/FileSystem Path Implications
- Browser connection is a prerequisite for all browser path operations
- Terminal and filesystem paths work independently of browser connection
- Electron apps are a browser path variant — same CDP, different target

## Dependencies on Other Sections
- **Depends on:** Section 4 (Policy Engine) — auth operations are high-risk
- **Supports:** Section 5 (Agent Action Surface) — actions need a browser connection
- **Supports:** Section 6 (A11y Snapshot) — snapshots work with any browser connection
- **Supports:** Section 10 (Observability) — browser health checks depend on connection state

## Risks/Tradeoffs
- **Risk:** Attaching to real browser is dangerous (agent sees real tabs, can act on real accounts). Mitigation: `high` risk classification, require confirmation by default in `safe`/`balanced` profiles.
- **Risk:** Profile management complexity grows. Mitigation: v1 keeps it simple (3 modes), post-v1 adds more.
- **Tradeoff:** Real browser attachment is more useful but riskier than managed profiles. Accepted — the user controls the risk via policy profile.

## Open Questions
None. `bc browser launch` is the safe default for browser creation, while `bc browser attach` is always explicit because it targets a real running browser with existing user state.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Study and adapt proven attach/profile/session patterns.**

Browser connection, profile management, and session UX have been solved by multiple upstream projects. No need to design these flows from zero.

**Upstream sources:**
- **browser-use** (Python) — profile management, session UX patterns, provider abstraction concept.
- **chrome-devtools-mcp** (TypeScript) — CDP connection patterns, Chrome attachment.

**What to reuse:**
- Profile management UX patterns (shared/isolated/named profiles)
- Connection mode concepts (managed vs attach vs restore)
- Auth state persistence patterns (cookie/storage export/import)
- CDP connection handling from chrome-devtools-mcp

**What NOT to reuse:**
- Do not import upstream's single-browser session model — Browser Control's session binds browser + terminal + file-system
- Do not import Python profile management code — adapt the UX patterns into TypeScript
- Do not assume upstream security model — Browser Control's policy engine (Section 04) governs all browser operations

**Mixed-language note:** browser-use is Python. Study its profile/session UX, translate the interaction patterns into Browser Control's TypeScript. CDP connection code from chrome-devtools-mcp is TypeScript and can be studied directly.

## Implementation Success Criteria
- Real browser attachment is reliable across Chrome, Chromium, and Electron
- Login-heavy workflows are practical without re-authenticating every run
- Electron apps fit naturally into the browser connection model
- The user always understands what session they are using (clear status output)
- Auth state persistence works for common auth patterns (cookie-based, localStorage-based)
