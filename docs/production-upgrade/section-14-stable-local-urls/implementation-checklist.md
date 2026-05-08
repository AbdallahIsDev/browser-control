# Section 14: Stable Local URLs — Implementation Checklist

## Reuse Decision

- [x] Evaluated `portless` and similar dependencies
- [x] Decision: **Reimplement in Browser Control** (Bucket 3)
- **Reason:** `portless` provides DNS-level `.localhost` resolution and reverse-proxy behavior. Section 14 spec explicitly forbids DNS rewriting, reverse proxies, and background daemons. A narrow native registry (~200 LOC) integrates cleanly into Browser Control's existing action surface, paths, and persistence patterns without adding transitive dependencies or architectural mismatch.

## Implementation Tasks

### Path Layer
- [x] Add `getServicesDir()` and `getServiceRegistryPath()` to `paths.ts`
- [x] Update `ensureDataHomeAtPath()` to create `services/` directory

### Core Service Subsystem
- [x] Implement `services/registry.ts` — JSON registry with load/save/CRUD
- [x] Implement `services/resolver.ts` — URL resolution with health probing
- [x] Implement `services/detector.ts` — narrow dev-server detection (Vite, Next.js, Webpack)

### Action Surface
- [x] Implement `service_actions.ts` — register, list, resolve, remove with ActionResult
- [x] Update `execution_router.ts` — classify service actions as `command` path, `low` risk

### Browser Integration
- [x] Update `browser_actions.ts` — resolve service refs before `browser_navigate` policy check

### TypeScript API
- [x] Update `browser_control.ts` — add `ServiceNamespace` to `BrowserControlAPI`
- [x] Update `index.ts` — export new service types and modules

### CLI
- [x] Update `cli.ts` — add `service` subcommand (register, list, resolve, remove)
- [x] Update `cli.ts` — `bc open <name>` uses shared resolver automatically
- [x] Update `cli.ts` help text

### MCP Integration
- [x] Create `mcp/tools/service.ts` — `bc_service_list`, `bc_service_resolve`
- [x] Update `mcp/tool_registry.ts` — include service tools in registry and categories

### Tests
- [x] Create `services/registry.test.ts` — persistence, corrupt-file recovery, CRUD
- [x] Create `services/resolver.test.ts` — bc:// resolution, bare names, URL passthrough, health errors
- [x] Create `services/detector.test.ts` — detection logic for known configs
- [x] Create `service_actions.test.ts` — action surface integration
- [x] Create `mcp/tools/service.test.ts` — MCP tool registry and behavior
- [x] Update `browser_actions.test.ts` — service ref resolution in open path

## Verification Tasks
- [x] `npm run typecheck` passes
- [x] `npm test` passes
- [x] New tests cover registry, resolver, detector, actions, MCP, and browser integration

## Orchestrator-Only Items (do not mark as done)
- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message
