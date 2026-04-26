# Section 20 Implementation Checklist

## Reading

- [x] Read `README.md`.
- [ ] Read `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md` (missing in this worktree).
- [x] Read `docs/production-upgrade/README.md`.
- [x] Read `docs/production-upgrade/STATUS.md`.
- [x] Read Section 20 `spec.md`.
- [x] Inspect package scripts, TypeScript config, env example, CLI entry points, focused tests, runtime cleanup files, and workflow directory state.

## CI Workflow Creation

- [x] Create required `.github/workflows/ci.yml`.
- [x] Add Windows/Linux/macOS Node 22 matrix.
- [x] Add Windows lifecycle and cleanup diagnostics job.
- [x] Add package smoke job.

## Package Scripts

- [x] Add `test:ci`.
- [x] Add `test:mcp`.
- [x] Add `test:lifecycle`.
- [x] Add `test:package`.
- [x] Add `docs:check`.
- [x] Add `audit:high`.

## Package Smoke

- [x] Create `scripts/ci_package_smoke.cjs`.
- [x] Run build before pack.
- [x] Verify expected runtime files are included.
- [x] Verify obvious unwanted files are excluded.
- [x] Remove generated tarball.

## Docs/Status Check

- [x] Create `scripts/check_production_status.cjs`.
- [x] Verify `STATUS.md` exists.
- [x] Verify section folders 04-23 exist.
- [x] Verify every section folder has `spec.md`.
- [x] Verify Sections 17-23 appear in `STATUS.md`.
- [x] Verify a README points to `STATUS.md`.

## Lifecycle Tests

- [x] Keep focused lifecycle script covering daemon launch, node-pty Windows patch, leak detection, API/CLI terminal exits, and cold-start exits.
- [x] Run lifecycle baseline locally on Windows.
- [x] Keep lifecycle required on Windows CI.

## Optional Browser Workflow

- [x] Create manual/scheduled browser smoke workflow.
- [x] Install Playwright Chromium explicitly.
- [x] Keep browser smoke out of required PR CI.

## Release Checklist

- [x] Create `docs/release-checklist.md`.
- [x] Include local gates, required CI jobs, audit, package smoke, Windows cleanup, MCP stdio, docs/status, version/tag, publish approval, and rollback notes.

## Verification

- [x] Run `npm run typecheck`.
- [x] Run `npm run docs:check`.
- [x] Run `npm run test:ci`.
- [x] Run `npm run test:mcp`.
- [x] Run `npm run test:lifecycle`.
- [x] Run `npm run test:package`.
- [x] Run `npm run audit:high`.
- [x] Run optional `npm run test:browser-smoke`.
- [x] Inspect workflow YAML.
- [x] Run final process cleanup check.

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator.
- [ ] Changes committed and pushed by orchestrator with final commit message.
