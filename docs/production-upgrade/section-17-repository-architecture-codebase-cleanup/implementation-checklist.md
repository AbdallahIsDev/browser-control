# Section 17 Repository Architecture and Codebase Cleanup Implementation Checklist

## Section

- Section: `17 Repository Architecture and Codebase Cleanup`
- Spec: `spec.md`
- Status: `ready for orchestrator review`

## Pre-Implementation Reading

- [x] Read `README.md`
- [ ] Read `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md`
- [x] Read `docs/production-upgrade/README.md`
- [x] Read `docs/production-upgrade/STATUS.md`
- [x] Read `docs/production-upgrade/section-17-repository-architecture-codebase-cleanup/spec.md`

## Inventory

- [x] Run `git status --short --branch`
- [x] Run baseline `npm run typecheck`
- [x] Run focused baseline tests
- [x] Inventory root files
- [x] Inventory top-level directories
- [x] Inspect entrypoints, shared modules, and feature clusters
- [x] Identify root entrypoints that should remain root
- [x] Identify implementation files that should move
- [x] Identify compatibility wrappers required for old imports
- [x] Identify files intentionally not moved

## Folder Structure Design

- [x] Create target feature folders
- [x] Define ownership boundaries for moved modules
- [x] Document target layout in `docs/architecture/source-layout.md`
- [x] Document root files that intentionally remain
- [x] Document compatibility wrapper policy

## File Moves

- [x] Move shared utilities where safe
- [x] Move policy/router implementation files
- [x] Move filesystem implementation files
- [x] Move browser implementation files
- [x] Move terminal implementation files
- [x] Move runtime/daemon implementation files
- [x] Move knowledge implementation files

## Compatibility Re-Exports

- [x] Leave root compatibility wrappers for moved shared modules
- [x] Leave root compatibility wrappers for moved policy/router modules
- [x] Leave root compatibility wrappers for moved filesystem modules
- [x] Leave root compatibility wrappers for moved browser modules
- [x] Leave root compatibility wrappers for moved terminal modules
- [x] Leave root compatibility wrappers for moved runtime modules
- [x] Leave root compatibility wrappers for moved knowledge modules

## Import Updates

- [x] Update internal imports to prefer new module locations
- [x] Update `index.ts` exports to prefer new module locations
- [x] Keep package and CLI entrypoint behavior stable
- [x] Avoid duplicate real implementations for moved modules

## Tests

- [x] Add lightweight compatibility smoke tests if useful
- [x] Update tests only when needed for moved module paths

## Verification

- [x] Run `npm run typecheck`
- [x] Run required focused tests
- [x] Run moved-browser focused tests if browser files move
- [x] Run moved-terminal focused tests if terminal files move
- [x] Run moved-filesystem focused tests if filesystem files move
- [x] Run moved-policy focused tests if policy files move
- [x] Run CLI smoke checks
- [x] Try `npm test`
- [x] Run final `git status --short`

## Notes

- `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md` is referenced by production-upgrade docs but is absent from this worktree.
- Tests already exercise root compatibility wrappers heavily, so no separate compatibility-only test file was added.
- `browser_connection.test.ts` requires a longer timeout on this Windows/WSL setup because restored bridge-script lookup waits for WSL CDP bridge readiness.
- Intentionally deferred root implementation modules are documented in `docs/architecture/source-layout.md`.

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
