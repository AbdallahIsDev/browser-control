# Section 21 Implementation Checklist

## Reading

- [x] Read `README.md`.
- [ ] Read `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md`.
- [x] Read `docs/production-upgrade/README.md`.
- [x] Read `docs/production-upgrade/STATUS.md`.
- [x] Read `docs/production-upgrade/section-21-e2e-reliability-golden-workflows/spec.md`.
- [x] Inspected requested CLI, API, browser, terminal, MCP, observability, provider, daemon, and related test files.

Note: `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md` is not present in this worktree.

## Implementation

- [x] Local fixture server created under `tests/e2e/fixtures/local-app/` after Section 24 layout migration.
- [x] Local web app workflow added.
- [x] MCP stdio workflow added.
- [x] Failure recovery workflow added.
- [x] Terminal resume workflow added.
- [x] Provider/service workflow added.
- [x] Reliability report helper added.
- [x] Cleanup verification helper added.
- [x] Package scripts added.
- [x] Examples tied to actual E2E commands added.

## Verification

- [x] `npm run typecheck`
- [x] `npm run test:e2e`
- [x] Focused related tests
- [x] `npm test` attempted
- [x] Latest reliability report inspected
- [x] Final Windows cleanup scan
- [x] `docs/production-upgrade/STATUS.md` updated after verification

## Orchestrator-Only Completion

- [ ] Orchestrator reviewed Section 21.
- [ ] Section 21 merged into `main`.
