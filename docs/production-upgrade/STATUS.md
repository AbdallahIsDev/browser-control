# Browser Control Production Upgrade Status

This file is the canonical implementation status for the production-upgrade roadmap.

Last synchronized: 2026-04-26 section-24 implementation branch

## Summary

- Sections 4 through 15 are implemented and merged into `main`.
- Section 16 is not implemented yet.
- Sections 17 through 23 are implemented and merged into `main` as the premium-readiness wave.
- Section 24 is implemented on its dedicated branch and is pending orchestrator review/merge.
- Sections 25 through 30 have implementation evidence in the current worktree, but their production-upgrade section folders/specs are not present in this checkout.
- The branch `codex/remote-browser-tool-api` is not merged into `main`, but it is not one of the numbered production-upgrade roadmap sections.
- Section-specific `implementation-checklist.md` files are execution artifacts. This status file is the source of truth when checklist history and merge status disagree.

## Section Status

| Section | Feature | Status | Main Evidence | Notes |
|---|---|---:|---|---|
| 04 | Policy Engine + Execution Router | Implemented and merged | `2a65d1b` | Implemented before the checklist workflow was standardized. |
| 05 | Agent Action Surface | Implemented and merged | `2357d46` | Implemented before the checklist workflow was standardized. |
| 06 | Accessibility Snapshot + Ref Layer | Implemented and merged | `eed40cd` | Branch `codex/section-06-a11y-snapshot-ref-layer` is merged into `main`. |
| 07 | MCP Integration Layer | Implemented and merged | `a609ff0`, `5f8f8ea` | Includes MCP stdio/logging cleanup and `.env.example` coverage. |
| 08 | Real Browser / Profiles / Session UX | Implemented and merged | `70be71e` | Branch `codex/section-08-real-browser-profiles-session-ux` is merged into `main`. |
| 09 | Knowledge System | Implemented and merged | `0b1e66d` | Branch `codex/section-09-knowledge-system` is merged into `main`. |
| 10 | Self-Debugging and Observability | Implemented and merged | `f7e9224`, `cd35554` | Includes post-review fixes for bundle path safety, failure bundles, redaction, MCP policy routing, and network capture cleanup. |
| 11 | Operator UX | Implemented and merged | `5330bbc`, `cd35554` | Includes config/status/setup/doctor docs and the Section 10/11 CLI merge integration fix. |
| 12 | Native Terminal Automation Layer | Implemented and merged | `ec96dd6` | Branch `codex/section-12-native-terminal-automation-layer` is merged into `main`. |
| 13 | Terminal Resume and State Serialization | Implemented and merged | `a255288` | Branch `codex/section-13-terminal-resume-state-serialization` is merged into `main`. |
| 14 | Stable Local URLs | Implemented and merged | `f0e0e84` | Branch `codex/section-14-stable-local-urls` is merged into `main`. |
| 15 | Remote Browser Provider Layer | Implemented and merged | `f353124` | Branch `codex/section-15-remote-browser-provider-layer` is merged into `main`. |
| 16 | Benchmarks and Examples | Not implemented | None | Remaining earlier roadmap section. |
| 17 | Repository Architecture and Codebase Cleanup | Implemented and merged | `2d5321b` | Premium-readiness phase: reduce root clutter and make the codebase navigable. |
| 18 | Security, Privacy, and Policy Hardening | Implemented and merged | `2d5321b` | Premium-readiness phase: threat model, secrets, policy bypass, dependency and MCP exposure review. |
| 19 | Install, Packaging, and First-Run Experience | Implemented and merged | `2d5321b` | Premium-readiness phase: clean install, npm/bin packaging, setup validation. |
| 20 | CI, Release Gates, and Cross-Platform Verification | Implemented and merged | `2d5321b` | Premium-readiness phase: GitHub Actions, release gates, Windows/Linux/macOS verification. |
| 21 | End-to-End Reliability and Golden Workflows | Implemented and merged | `2d5321b`, `e3e1514` | Premium-readiness phase: real workflow proof across browser, terminal, fs, MCP, and recovery. |
| 22 | Documentation and Product Onboarding Cleanup | Implemented and merged | `2d5321b` | Premium-readiness phase: user/admin/developer docs, quickstarts, examples, troubleshooting. |
| 23 | Public API, Versioning, and Compatibility Contract | Implemented and merged | `2d5321b` | Premium-readiness phase: CLI/API/MCP stability and compatibility guarantees. |
| 24 | Repository Structure and Module Organization | Implemented on branch | Branch `codex/section-24-repository-structure-module-organization` | Moves production code under `src/`, tests under `tests/`, preserves root compatibility entrypoints, and updates scripts/snapshots. Pending orchestrator review and merge. |
| 25 | Locator and Ref Reliability | Implemented in current worktree | `src/cli.ts`, `src/browser/actions.ts`, `src/a11y_snapshot.ts` | Source includes locator/ref handling, stale-ref recovery, and CLI locator handler evidence. Section folder/spec is missing from this checkout. |
| 26 | Agentic Screencast and Debug Receipts | Implemented in current worktree | `src/observability/screencast.ts`, `src/observability/debug_bundle.ts`, `SECTION_26_IMPLEMENTATION_CHECKLIST.md` | Screencast lifecycle, action timeline, receipts, debug-bundle integration, CLI/API hooks. Section folder/spec is missing from this checkout. |
| 27 | Browser Discovery, Attach UX, Downloads, and Drop I/O | Implemented in current worktree | `src/browser/connection.ts`, `src/browser/actions.ts`, `src/mcp/tools/browser.ts` | CDP alias attach, explicit attach target handling, clean detach, drop files/data, downloads list. Section folder/spec is missing from this checkout. |
| 28 | Operator Dashboard and Web/Desktop UI | Implemented in current worktree | `web/src/App.tsx`, `src/web/server.ts`, `src/operator/dashboard.ts`, `src/operator/generated_ui.ts` | Local dashboard, pages, web API, desktop wrapper hooks, and native generated UI schema/dispatcher. Still missing json-render runtime/devtools and full browser terminal polish. |
| 29 | Workflow Graph and Self-Healing Harness | Implemented in current worktree | `src/workflows/*`, `src/harness/*`, `src/mcp/tools/workflow.ts` | Linear durable workflow runtime plus helper registry/validation/local-temp sandbox. Missing branching/loops and generated helper loop. |
| 30 | Automation Packages and Evals | Implemented in current worktree | `src/packages/*`, `automation-packages/tradingview-ict-analysis/`, `tests/unit/packages.test.ts` | Local package install/list/info/update/remove/grant/run/eval. Missing remote marketplace, signing, and package UI generation. |

## Current Worktree Sync Expectation

Every active section worktree should carry the same `docs/production-upgrade` folder contents as `main` after documentation synchronization. If a section worktree is intentionally kept for branch archaeology, its code can remain branch-specific, but these production-upgrade docs should still identify the same roadmap status.

## Update Rules

When future work changes roadmap status:

1. Update this file first.
2. Keep `docs/production-upgrade/README.md` pointing here as the canonical status source.
3. If a section creates or updates an `implementation-checklist.md`, keep it consistent with this status file before merge.
4. After a section is merged, synchronize `docs/production-upgrade` from `main` into any still-open section worktrees.
