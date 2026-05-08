# Section 14: Stable Local URLs

## Purpose
Agents struggle with changing localhost ports. When running multiple local services (API server, dashboard, dev server), ports shift between restarts and sessions. Stable local URLs give agents a deterministic, semantic way to reference local services without tracking port numbers.

## Why This Section Matters to Browser Control
This is a quality-of-life layer that reduces friction in multi-service workflows. It is not a core dependency for any other section — the browser, terminal, and execution router all work without it. But when an agent needs to open `trading-dashboard` instead of `http://127.0.0.1:5173`, stable URLs make the interaction cleaner and more deterministic.

## Priority
This is a **later-priority / post-v1 expansion** section. It should not block any mandatory v1 work (Sections 04–13). Implement after the core engine, action surface, MCP, terminal, and browser sessions are solid.

## Scope
- Optional named local URL resolution (e.g., `api.localhost` → `127.0.0.1:3000`)
- Service registry that maps names to ports
- Automatic port detection for known services
- Agent-friendly service references in browser commands

## Non-Goals
- Do not make this required for Browser Control v1
- Do not block core work behind stable URL support
- Do not build a full reverse proxy or DNS server
- Do not support remote services — local only
- Do not interfere with real `.localhost` DNS resolution if the OS supports it

## User-Facing Behavior
- `bc service register <name> --port <port>` — register a named local service
- `bc service list` — show registered services and their ports
- `bc service resolve <name>` — get the URL for a named service
- `bc open trading-dashboard` — resolves to the registered URL automatically

## Agent-Facing Behavior
- Agent refers to services by semantic name in browser commands
- Agent doesn't need to discover or track port numbers
- Agent receives clear errors when a named service is not running (port not responding)
- Agent can list available services and their health status

## Architecture/Design

### Service Registry
A simple mapping stored in the data directory:
```json
{
  "trading-dashboard": { "port": 5173, "protocol": "http", "path": "/" },
  "api-server": { "port": 3000, "protocol": "http", "path": "/api" },
  "docs": { "port": 4000, "protocol": "http", "path": "/" }
}
```

### Resolution
When an agent calls `bc open trading-dashboard`:
1. Look up `trading-dashboard` in the service registry
2. Check if the port is responding (TCP connect or HTTP health check)
3. If responding: navigate to `http://127.0.0.1:5173/`
4. If not responding: return a clear error — "Service 'trading-dashboard' is registered on port 5173 but not responding"

### Auto-Detection (Optional)
For common dev servers, detect the port automatically:
- Vite: check `vite.config.*` or detect the running process
- Next.js: default 3000, check `next.config.*`
- Webpack dev server: default 8080
- Express: check `app.listen()` in project files

This is a convenience feature, not a requirement. Manual registration always works.

## Core Components/Modules
- `services/registry.ts` — service name → port mapping, CRUD
- `services/resolver.ts` — name → URL resolution with health check
- `services/detector.ts` — auto-detect known dev server ports (optional)

## Data Models/Interfaces
```typescript
interface ServiceEntry {
  name: string;
  port: number;
  protocol: "http" | "https";
  path: string;
  registeredAt: string;
  lastHealthCheck?: string;
  healthy?: boolean;
}
```

## Session/State Implications
- Service registry is global (not session-scoped) — shared across all sessions
- Registry persists in the data directory
- Health check results are cached briefly (30s) to avoid excessive probing

## Permissions/Guardrails Implications
- Registering a service: `low` risk (configuration only)
- Resolving a service: `low` risk (read registry + TCP probe)
- Auto-detection: `low` risk (reads project config files)
- No high-risk operations in this section

## Failure/Recovery Behavior
- If a registered service's port is not responding: return a clear "not running" error
- If the registry file is corrupt: reset to empty, log warning
- If auto-detection finds a port but it conflicts with an existing registration: warn and keep existing

## CLI/API/MCP Implications
- CLI: `bc service register/list/resolve/remove`
- CLI: `bc open <service-name>` resolves through the registry
- MCP: `bc_service_list`, `bc_service_resolve`
- API: `bc.service.register()`, `bc.service.resolve()`

## Browser/Terminal/FileSystem Path Implications
- Stable URLs primarily affect the browser path (opening URLs)
- Terminal path could benefit (e.g., `curl api.localhost`) but is not a v1 priority
- Filesystem path is not affected

## Dependencies on Other Sections
- **Depends on:** Section 5 (Agent Action Surface) — service resolution integrates with `bc open`
- **Supports:** Section 8 (Browser Sessions) — named URLs simplify session workflows
- **Not blocking:** No section depends on this

## Risks/Tradeoffs
- **Risk:** `.localhost` resolution conflicts with OS-level DNS. Mitigation: use explicit prefix (`bc:trading-dashboard`) or make it opt-in.
- **Risk:** Port detection is unreliable for exotic setups. Mitigation: manual registration always works, auto-detection is optional.
- **Tradeoff:** Adds complexity for a convenience feature. Accepted because multi-service workflows are common enough to justify it.

## Open Questions
- Should stable URLs use a custom scheme (`bc://trading-dashboard`) or real localhost names? Recommendation: custom scheme for v1, real localhost names as opt-in post-v1.
- Should service health checks be passive (on-demand) or active (background polling)? Recommendation: passive for v1.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Dependency-first — use portless or similar.**

This is almost certainly a dependency candidate. Do not rebuild stable local URL resolution from scratch.

**Upstream sources:**
- **portless** (https://github.com/vercel-labs/portless) — stable local URLs for development. Directly solves this problem.

**What to reuse:**
- The entire concept and, ideally, the tool itself as a dependency
- Service name → port resolution
- Health checking for local services

**What NOT to reuse:**
- If portless doesn't integrate cleanly with Browser Control's daemon/session model, vendor the minimal resolution logic and adapt
- Do not rebuild if a dependency works — this is a convenience feature, not a differentiator

**Mixed-language note:** If portless is not TypeScript, consider whether it can be used as a CLI tool dependency (called via exec) or whether a narrow TypeScript implementation of just the resolution logic is simpler.

## Implementation Success Criteria
- Agents can refer to services semantically instead of by random ports
- Service resolution works reliably when the service is running
- Clear error messages when services are not running
- Registry persists across daemon restarts
- Auto-detection correctly identifies at least Vite, Next.js, and Webpack dev servers
