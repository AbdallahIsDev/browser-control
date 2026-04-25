# Section 11 Operator UX Implementation Checklist

## Section

- Section: `11 Operator UX`
- Spec: `spec.md`
- Status: `ready for orchestrator review`

## Implementation Tasks

- [x] Read `spec.md` and identify the concrete code entry points
- [x] Identify existing files/modules that must be extended
- [x] Add user-scoped config storage, metadata, validation, source tracking, and redaction
- [x] Add `bc config list|get|set` with human and JSON output
- [x] Add operator doctor checks with critical failure exit semantics
- [x] Add non-interactive and interactive setup flow
- [x] Add unified status aggregation for stopped and reachable daemon states
- [x] Add TypeScript API config/status namespaces
- [x] Add MCP `bc_status`
- [x] Add broker/API equivalents where appropriate
- [x] Add public docs and narrow `.gitignore` tracking rules
- [x] Update package repository/homepage/bugs metadata
- [x] Add or update focused tests for Section 11 behavior
- [x] Run targeted verification for changed areas
- [x] Run broader verification required by the section

## Notes

- `origin/main`, this branch, and `origin/codex/section-10-self-debugging-observability` currently point at the same commit, so no separate Section 10 merge is needed before Section 11 work.
- `rg` is unavailable in this desktop environment due an access-denied error from the bundled executable; use `git ls-files`, `Select-String`, and PowerShell file reads instead.
- Do not add ignored planning docs broadly. Only public docs should be unignored/tracked.
- Verification completed: `npm run typecheck`, requested targeted `node --test` suites, `npm audit --audit-level=high`, `npm test`, CLI JSON smoke checks, and Windows helper-process cleanup check.

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
