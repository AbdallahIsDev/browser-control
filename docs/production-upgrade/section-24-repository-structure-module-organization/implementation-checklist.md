# Section 24 Implementation Checklist

Use this checklist during implementation. Mark concrete implementation tasks complete only after code and local verification are done.

## Read First

- [ ] Read `README.md`
- [ ] Read `docs/production-upgrade/README.md`
- [ ] Read `docs/production-upgrade/STATUS.md`
- [ ] Read `docs/production-upgrade/REUSE-STRATEGY.md`
- [ ] Read `docs/production-upgrade/section-24-repository-structure-module-organization/spec.md`
- [ ] Read `package.json`, `tsconfig.json`, and current compatibility tests

## Inventory

- [ ] Inventory root `.ts` files and classify each into target `src/` folder
- [ ] Inventory root `.test.ts` / `.test.cjs` files and classify each into target `tests/` folder
- [ ] Inventory public exports from `index.ts`
- [ ] Inventory package `main`, `types`, `bin`, `files`, and build scripts
- [ ] Inventory CLI, MCP, e2e, compatibility, and package smoke import paths
- [ ] Write migration order in this checklist before moving files

## Migration Tasks

- [ ] Create target folders under `src/`
- [ ] Move shared/runtime/config modules first and update imports
- [ ] Move policy/session/action-result modules and update imports
- [ ] Move browser modules and update imports
- [ ] Move terminal modules and update imports
- [ ] Move filesystem modules and update imports
- [ ] Move services/providers/observability/operator modules and update imports
- [ ] Move CLI and MCP source entrypoints and update package/bin/build references
- [ ] Move tests into `tests/` groups or document root exceptions
- [ ] Preserve public API exports via `src/index.ts` and root compatibility entrypoint if needed
- [ ] Update docs/examples that reference old paths
- [ ] Update compatibility snapshots only for intentional path/env/package surface changes

## Verification

- [ ] Run focused tests after each migration slice
- [ ] Run `npm run typecheck`
- [ ] Run `npm run test:ci`
- [ ] Run `npm run test:mcp`
- [ ] Run `npm run test:e2e`
- [ ] Run `npm run compat:test`
- [ ] Run `npm run docs:check`
- [ ] Run `npm run test:package`
- [ ] Run `npm run package:smoke`
- [ ] Confirm `git status --short` contains only intentional changes

## Documentation

- [ ] Add/update architecture docs describing final source layout
- [ ] Update developer onboarding docs with new file locations
- [ ] Update production upgrade status for Section 24 implementation result

## Orchestrator-Only Final Items

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
