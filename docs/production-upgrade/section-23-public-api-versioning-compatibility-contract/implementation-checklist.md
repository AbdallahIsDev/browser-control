# Implementation Checklist Template

## Section

- Section: `23 Public API, Versioning, and Compatibility Contract`
- Spec: `spec.md`
- Status: `in progress`

## Implementation Tasks

- [x] Read `spec.md` and identify the concrete code entry points
- [x] Identify existing files/modules that must be extended
- [x] Inventory CLI commands, flags, documented CLI JSON output shapes, TypeScript exports, API namespaces, MCP tools, config keys, data paths, and persisted public formats
- [x] Add deterministic public-surface inventory helpers
- [x] Add compatibility snapshot update workflow
- [x] Generate public-surface snapshot fixtures
- [x] Add compatibility tests for snapshots, CLI help, CLI JSON output shapes, MCP registry, TypeScript imports, config/env vars, ActionResult fields, and persisted format shapes
- [x] Integrate compatibility npm scripts
- [x] Add compatibility/versioning/deprecation docs
- [x] Run targeted verification for the changed area
- [ ] Run broader verification required by the section

## Notes

- `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md` and `docs/security.md` are not present in this worktree. Section spec and present production-upgrade docs were used.
- Snapshot fixtures use placeholders for timestamps, data-home paths, paths, and secrets.
- `npm test` timed out after 364 seconds in this environment; `browser_connection.test.ts` also timed out when run alone after 94 seconds. Targeted compatibility/config/MCP checks passed.
- Final acceptance and commit items stay orchestrator-only.

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
