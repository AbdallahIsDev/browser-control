# Source Layout

Browser Control keeps product implementation under `src/`, tests under `tests/`, docs under `docs/`, scripts under `scripts/`, and only public/package compatibility entrypoints at the repository root.

## Folder Map

- `src/` owns production TypeScript implementation and public API barrels.
- `src/browser/` owns browser automation: CDP/Playwright connection, browser actions, profiles, auth snapshots, Stagehand integration, network interception, and browser file transfer helpers.
- `src/terminal/` owns native terminal automation: pty sessions, one-shot exec, prompt detection, snapshots, resume decisions, serialization, buffer persistence, shell/platform detection, and the Windows `node-pty` patch.
- `src/filesystem/` owns native filesystem/system operations and the policy-aware filesystem action facade.
- `src/policy/` owns execution path/risk types, policy profiles, the policy engine, audit logging, and the execution router.
- `src/runtime/` owns long-running and process runtime code: daemon, broker server/types, daemon launch and cleanup, health checks, memory store, task engine, scheduler, and telemetry.
- `src/knowledge/` owns knowledge artifact types, storage, queries, and validation.
- `src/shared/` owns cross-cutting utilities used by many systems: `ActionResult`, config loading/user config, path resolution, and logging.
- `src/mcp/` owns MCP server startup, tool registry, schemas, and tool handlers.
- `src/observability/` owns debug bundles, redaction, captures, recovery, performance, and shared observability types.
- `src/operator/` owns human/operator CLI support such as doctor, setup, status, config formatting, and summaries.
- `src/providers/` owns browser provider abstractions and adapters.
- `src/services/` owns stable local service URL registry, resolver, and detector.
- `src/skills/` owns built-in skill implementations.
- `tests/unit/` owns unit and integration-style node tests.
- `tests/e2e/` owns golden workflow tests and e2e fixtures/support.
- `tests/compatibility/` owns public API, CLI, MCP, persisted-format, and package import compatibility snapshots.
- `tests/helpers/` owns reusable test support.
- `scripts/` owns build, packaging, compatibility, docs, browser launch, and CI helper scripts.
- `docs/` owns product, architecture, API, and production-upgrade documentation.

## Root Files

Root files are reserved for package entrypoints, compatibility imports, repository metadata, and project configuration.

Root entrypoints intentionally remain:

- `index.ts` is the public TypeScript API compatibility barrel and re-exports `src/index.ts`.
- `cli.ts` and `cli.js` are package/bin compatibility entrypoints.
- `daemon.ts`, `broker_server.ts`, and `main.ts` preserve historical executable entrypoints while delegating to `src/`.
- `package.json`, lockfile, TypeScript configs, `README.md`, `LICENSE`, `.env.example`, and platform launcher shims remain at root.

Moved public modules keep root compatibility wrappers such as `browser_control.ts`, `browser_core.ts`, `terminal_actions.ts`, `policy_engine.ts`, `memory_store.ts`, `config.ts`, and `paths.ts`. These wrappers re-export `src/` implementation modules so existing imports keep working.

New production logic should not be added to root wrappers. Put it under `src/` and update the wrapper only when a public import path must stay stable.

## Import Policy

First-party implementation code should import from the owning `src/` module directly:

- browser code imports sibling browser modules from `./...`
- terminal code imports sibling terminal modules from `./...`
- shared utilities come from `../shared/...`
- policy code comes from `../policy/...`
- runtime code comes from `../runtime/...`

Root compatibility wrappers are for external/backward compatibility and tests that intentionally verify old import paths. New implementation code should not import from moved root wrappers.

## Tests

Tests live under `tests/` and keep historical names where that preserves context.

Going forward:

- name tests after the module or behavior they verify, e.g. `browser_actions.test.ts`
- keep compatibility smoke tests in `tests/compatibility/`
- keep golden workflows and local-app fixtures in `tests/e2e/`
- keep reusable harness code in `tests/helpers/`
- CI should test both public root compatibility imports and direct `src/` module paths

## Future Section Guidance

- Add new implementation under `src/`, not the repository root.
- Add new tests under `tests/unit/`, `tests/e2e/`, or `tests/compatibility/`.
- Preserve root/package compatibility wrappers unless a compatibility snapshot intentionally proves a breaking change.
- Update this file when new top-level folders or major source ownership boundaries are introduced.
