# Release Checklist

Browser Control releases are manual. Do not publish to npm or create GitHub releases unless the maintainer explicitly approves that action.

## Pre-Release Local Gates

- Confirm working tree contains only intended release changes.
- Run `npm ci`.
- Run `npm run typecheck`.
- Run `npm run docs:check`.
- Run `npm run test:ci`.
- Run `npm run test:mcp`.
- Run `npm run test:lifecycle` on Windows before release.
- Run `npm run test:package`.
- Run `npm run audit:high`.
- Run optional browser smoke when browser/runtime changes are included.
- Inspect package contents from the package smoke output if packaging files changed.

## Required CI Jobs

- CI required matrix on `ubuntu-latest`, `windows-latest`, and `macos-latest` with Node 22.
- Windows lifecycle and cleanup job.
- Package smoke job.
- High/critical npm audit gate.
- Docs/status drift check.
- MCP stdio cleanliness tests.

## Windows Cleanup Expectations

- No visible daemon `cmd.exe` windows unless visible mode is explicitly requested.
- No repeated terminal or daemon window spam.
- No leftover daemon, terminal helper, Chrome, or WSL CDP bridge processes after lifecycle tests.
- `daemon_launch.test.ts`, `node_pty_windows_patch.test.ts`, `process_leak_detection.test.ts`, `api_term_exit.test.ts`, `cli_term_exit.test.ts`, and `cold_start_exit.test.ts` must be considered before release.

## MCP Stdio Expectations

- MCP stdio stdout is reserved for protocol frames.
- Normal logs must not pollute MCP stdout.
- `npm run test:mcp` is required before release.

## Version And Tag Steps

- Update version only after gates pass.
- Update changelog or release notes if present.
- Update `docs/production-upgrade/STATUS.md` when roadmap section status changes.
- Create tag only after maintainer approval.
- Publish only after explicit maintainer approval.

## Rollback Notes

- If package smoke fails, do not publish. Fix package files or revert the package-related change.
- If audit fails at high or critical severity, fix, override only with documented maintainer approval, or hold release.
- If Windows lifecycle fails, inspect cleanup diagnostics before rerun.
- If release is already published and must be withdrawn, coordinate owner approval before npm deprecate/unpublish actions.
