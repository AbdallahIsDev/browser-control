# Section 20: CI, Release Gates, and Cross-Platform Verification

## Purpose

Manual verification is not enough for a premium automation product. Browser Control needs automated release gates that catch regressions across operating systems and execution surfaces.

This section adds CI and release readiness checks.

## Scope

- Add GitHub Actions workflows for typecheck, tests, audit, packaging smoke tests, and docs checks.
- Run core checks on Windows, Linux, and macOS.
- Keep browser-dependent tests explicit and skippable when Chrome is unavailable.
- Add focused jobs for MCP stdio cleanliness, daemon lifecycle, terminal cleanup, and package install smoke tests.
- Add a release checklist document.
- Add status badges only if they reflect real CI jobs.

## Non-Goals

- Do not make every flaky or environment-heavy test mandatory on every push.
- Do not require paid cloud browser providers for normal CI.
- Do not publish releases automatically until the release process is explicitly approved.

## CI Matrix

Minimum jobs:

- Windows latest
- Ubuntu latest
- macOS latest
- Node versions matching package support

Minimum commands:

- `npm ci`
- `npm run typecheck`
- targeted non-browser tests
- MCP stdio tests
- package dry-run/install smoke
- `npm audit --audit-level=high`

Optional/manual jobs:

- full browser tests with installed Chrome
- long-running daemon/process leak tests
- remote provider smoke tests with secrets

## Release Gates

A release candidate should require:

- clean typecheck
- required tests pass on all supported OSes
- no high/critical audit findings
- package smoke install passes
- docs status current
- no known daemon/helper process leaks in Windows lifecycle tests

## Verification

- Run workflows locally where practical with direct commands.
- Push a branch and verify GitHub Actions result.
- Confirm CI does not expose secrets in logs.

## Success Criteria

- pull requests show meaningful pass/fail status
- Windows-specific process/window regressions are guarded
- package/install regressions are caught before release
- release readiness is documented and repeatable
