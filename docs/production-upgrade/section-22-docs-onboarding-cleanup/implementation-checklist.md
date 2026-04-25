# Section 22 Implementation Checklist

## Section

- Section: `22 Documentation and Product Onboarding Cleanup`
- Spec: `spec.md`
- Status: `ready for orchestrator review`

## Implementation Tasks

- [x] Read required roadmap/status/spec docs and identify documentation scope.
- [x] Inspect existing public docs for stale or contradictory content.
- [x] Inspect current CLI/API/MCP source surfaces before documenting behavior.
- [x] Run baseline `npm run typecheck`.
- [x] Rewrite `README.md` as concise product entrypoint.
- [x] Update public docs for getting started, CLI, API, MCP, browser, terminal, security, troubleshooting, support, and configuration.
- [x] Add copy-pasteable examples under `docs/examples/`.
- [x] Add a simple docs drift checker and `docs:check` script if practical.
- [x] Verify documented CLI command names against current help/source.
- [x] Verify documented MCP tool names against `mcp/tool_registry.ts`.
- [x] Run docs checker.
- [x] Run targeted source/tests verification for docs-relevant behavior.
- [x] Run sub-agent documentation, security, and code-review passes and fix confirmed findings.

## Notes

- `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md` is referenced by production-upgrade docs but is not present in this worktree.
- Full `npm test` timed out after 10 minutes in this environment; targeted docs-relevant tests passed after docs edits.
- Package dry-run includes public docs and excludes `docs/production-upgrade/`.
- This section is documentation-only except for a small deterministic docs checker.

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
