# Section 10: Self-Debugging and Observability — Implementation Checklist

- Section: **Section 10: Self-Debugging and Observability**
- Spec: `spec.md`
- Status: `implemented and merged`

## Implementation Tasks

- [x] Read `spec.md` and identify the concrete code entry points
- [x] Identify existing files/modules that must be extended
- [x] Implement observability core types (`observability/types.ts`)
- [x] Implement redaction helpers (`observability/redaction.ts`)
- [x] Implement bounded console capture (`observability/console_capture.ts`)
- [x] Implement bounded network capture (`observability/network_capture.ts`)
- [x] Implement debug bundle assembly/storage (`observability/debug_bundle.ts`)
- [x] Implement recovery guidance (`observability/recovery.ts`)
- [x] Implement performance instrumentation (`observability/performance.ts`)
- [x] Extend `health_check.ts` for browser/terminal/system checks
- [x] Extend `action_result.ts` with optional debug fields
- [x] Integrate debug evidence into browser/terminal/fs action failure paths
- [x] Add CLI commands: `bc doctor`, `bc status`, `bc debug bundle`, `bc debug console`, `bc debug network`
- [x] Add API debug namespace (`bc.debug.health()`, `bc.debug.bundle()`, etc.)
- [x] Add MCP debug tools: `bc_debug_health`, `bc_debug_failure_bundle`, `bc_debug_get_console`, `bc_debug_get_network`
- [x] Extend `paths.ts` for debug bundle/report locations
- [x] Extend `index.ts` with new exports
- [x] Add tests for all observability modules
- [x] Run typecheck and fix errors
- [x] Run tests and fix failures

## Verification Tasks

- [x] `npm run typecheck` passes
- [x] `node --require ts-node/register --require tsconfig-paths/register --test observability/*.test.ts` passes
- [x] `node --require ts-node/register --require tsconfig-paths/register --test health_check.test.ts mcp/tool_registry.test.ts` passes
- [x] `node --require ts-node/register --require tsconfig-paths/register --test browser_actions.test.ts terminal_actions.test.ts fs_actions.test.ts` passes
- [x] `node --require ts-node/register --require tsconfig-paths/register --test cli.test.ts daemon.test.ts broker_server.test.ts` passes
- [x] `npm audit --audit-level=high` passes
- [x] CLI JSON output is clean (no log pollution on stdout)

## Notes

- Debug bundle generation must be best-effort and bounded. If screenshot/snapshot/console/network capture fails, return a partial bundle instead of failing the original action.
- Do not store raw secrets. Redact auth headers, cookies, API keys, Browserless tokens, env secrets, and sensitive query params.
- Do not make every successful action expensive. Debug evidence is collected on failure paths, not success paths.
- Health checks must degrade gracefully when Chrome is not installed or no browser is connected.
- MCP stdio stdout must not be polluted with normal logs.

## Orchestrator-Only Completion

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message