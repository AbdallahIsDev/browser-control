# Source Layout

Browser Control keeps public entrypoints at the repository root and places implementation code in owned feature folders.

## Folder Map

- `browser/` owns browser automation: CDP/Playwright connection, browser actions, profiles, auth snapshots, Stagehand integration, network interception, and browser file transfer helpers.
- `terminal/` owns native terminal automation: pty sessions, one-shot exec, prompt detection, snapshots, resume decisions, serialization, buffer persistence, shell/platform detection, and the Windows `node-pty` patch.
- `filesystem/` owns native filesystem/system operations and the policy-aware filesystem action facade.
- `policy/` owns execution path/risk types, policy profiles, the policy engine, audit logging, and the execution router.
- `runtime/` owns long-running and process runtime code: daemon, broker server/types, daemon launch and cleanup, health checks, memory store, task engine, scheduler, and telemetry.
- `knowledge/` owns knowledge artifact types, storage, queries, and validation.
- `shared/` owns cross-cutting utilities used by many systems: `ActionResult`, config loading/user config, path resolution, and logging.

Existing stable folders remain in place:

- `mcp/` owns MCP server startup, tool registry, schemas, and tool handlers.
- `observability/` owns debug bundles, redaction, captures, recovery, performance, and shared observability types.
- `operator/` owns human/operator CLI support such as doctor, setup, status, config formatting, and summaries.
- `providers/` owns browser provider abstractions and adapters.
- `services/` owns stable local service URL registry, resolver, and detector.
- `skills/` owns built-in skill implementations.
- `scripts/` owns launch and helper scripts that are executed directly or wrapped by platform shims.
- `docs/` owns product, architecture, API, and production-upgrade documentation.

## Root Files

Root files are reserved for package entrypoints, compatibility imports, tests, repository metadata, and a small set of intentionally deferred implementation modules.

Root entrypoints intentionally remain:

- `index.ts` is the public TypeScript API barrel.
- `cli.ts` and `cli.js` are package/bin entrypoints.
- `main.ts` remains a local example/start script.
- `package.json`, lockfile, TypeScript configs, `README.md`, `LICENSE`, `.env.example`, and platform launcher shims remain at root.

Moved public modules keep root compatibility wrappers such as `browser_core.ts`, `terminal_actions.ts`, `policy_engine.ts`, `memory_store.ts`, `config.ts`, and `paths.ts`. These wrappers re-export the new implementation modules so existing imports keep working until Section 23 defines the formal compatibility contract.

Executable compatibility wrappers that must still run from root, such as `daemon.ts`, `broker_server.ts`, and `memory_store.ts`, also preserve their previous CLI behavior.

Some root implementation modules remain intentionally:

- `browser_control.ts` and `session_manager.ts` remain root-level orchestration/facade modules because they coordinate browser, terminal, filesystem, policy, service, provider, and daemon concerns.
- `a11y_snapshot.ts`, `ref_store.ts`, `semantic_query.ts`, and `snapshot_diff.ts` remain root-level a11y/ref/query modules for now; a future a11y-specific cleanup can move them together.
- `ai_agent.ts`, `captcha_solver.ts`, `proxy_manager.ts`, `selector_store.ts`, `selectors.ts`, and `stealth.ts` remain root-level browser-adjacent public utilities to avoid expanding this refactor beyond the Section 17 high-confidence clusters.
- `service_actions.ts`, `skill.ts`, `skill_registry.ts`, `skill_memory.ts`, and `skill_yaml.ts` remain root-level public service/skill surfaces while `services/` and `skills/` stay stable.
- `test_daemon_helpers.ts` is test support, not production API.

These deferred files should not be treated as missed moves. Future sections may move them only with matching compatibility wrappers and focused verification.

## Import Policy

First-party implementation code should import from the owning folder directly:

- browser code imports sibling browser modules from `./...`
- terminal code imports sibling terminal modules from `./...`
- shared utilities come from `../shared/...`
- policy code comes from `../policy/...`
- runtime code comes from `../runtime/...`

Root compatibility wrappers are for external/backward compatibility and tests that intentionally verify old import paths. New implementation code should not import from moved root wrappers.

## Tests

Tests currently remain at the repository root and use the historical `*.test.ts` naming style. That keeps this refactor behavior-neutral and avoids a simultaneous test-layout migration.

Going forward:

- name tests after the module or behavior they verify, e.g. `browser_actions.test.ts`
- keep compatibility smoke tests at root when they validate root import compatibility
- when a future section creates a new focused subsystem with many tests, it may place tests next to that subsystem if the repo adopts that pattern consistently
- Section 20 CI should test both public root compatibility imports and new folder module paths

## Future Section Guidance

- Section 18 security/privacy hardening should add security-specific policy or shared/runtime modules near the system they protect, and document any cross-cutting security helpers here.
- Section 19 install/packaging should preserve root package/bin entrypoints and avoid undoing the feature-folder layout.
- Section 20 CI should keep root compatibility import tests plus direct new-path import/typecheck coverage.
- Section 22 docs should reference this file as the developer orientation map.
- Section 23 public API/versioning should decide which compatibility wrappers become contractual, deprecated, or internal.
