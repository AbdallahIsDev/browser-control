# Section 24 Implementation Checklist

Use this checklist during implementation. Mark concrete implementation tasks complete only after code and local verification are done.

## Read First

- [x] Read `README.md`
- [x] Read `docs/production-upgrade/README.md`
- [x] Read `docs/production-upgrade/STATUS.md`
- [x] Read `docs/production-upgrade/REUSE-STRATEGY.md`
- [x] Read `docs/production-upgrade/section-24-repository-structure-module-organization/spec.md`
- [x] Read `package.json`, `tsconfig.json`, and current compatibility tests

## Inventory

- [x] Inventory root `.ts` files and classify each into target `src/` folder
- [x] Inventory root `.test.ts` / `.test.cjs` files and classify each into target `tests/` folder
- [x] Inventory public exports from `index.ts`
- [x] Inventory package `main`, `types`, `bin`, `files`, and build scripts
- [x] Inventory CLI, MCP, e2e, compatibility, and package smoke import paths
- [x] Write migration order in this checklist before moving files

Migration order used:

1. Move existing implementation folders (`browser`, `filesystem`, `knowledge`, `mcp`, `observability`, `operator`, `policy`, `providers`, `runtime`, `services`, `shared`, `skills`, `terminal`) under `src/`.
2. Move root production `.ts` modules under `src/` and create root compatibility wrappers.
3. Preserve direct executable behavior for `cli.ts`, `daemon.ts`, `broker_server.ts`, and `main.ts`.
4. Update `src/` internal imports and script imports.
5. Run typecheck after production move.
6. Move tests/support into `tests/unit`, `tests/e2e`, `tests/compatibility`, and `tests/helpers`.
7. Update package scripts, compatibility tools, docs, and snapshots.
8. Run required verification commands.

## Migration Tasks

- [x] Create target folders under `src/`
- [x] Move shared/runtime/config modules first and update imports
- [x] Move policy/session/action-result modules and update imports
- [x] Move browser modules and update imports
- [x] Move terminal modules and update imports
- [x] Move filesystem modules and update imports
- [x] Move services/providers/observability/operator modules and update imports
- [x] Move CLI and MCP source entrypoints and update package/bin/build references
- [x] Move tests into `tests/` groups or document root exceptions
- [x] Preserve public API exports via `src/index.ts` and root compatibility entrypoint if needed
- [x] Update docs/examples that reference old paths
- [x] Update compatibility snapshots only for intentional path/env/package surface changes

## Verification

- [x] Run focused tests after each migration slice
- [x] Run `npm run typecheck`
- [x] Run `npm run test:ci`
- [x] Run `npm run test:mcp`
- [x] Run `npm run test:e2e`
- [x] Run `npm run compat:test`
- [x] Run `npm run docs:check`
- [x] Run `npm run test:package`
- [x] Run `npm run package:smoke`
- [x] Confirm `git status --short` contains only intentional changes

## Documentation

- [x] Add/update architecture docs describing final source layout
- [x] Update developer onboarding docs with new file locations
- [x] Update production upgrade status for Section 24 implementation result

## Orchestrator-Only Final Items

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
