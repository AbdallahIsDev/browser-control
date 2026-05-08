# Section 19: Install, Packaging, and First-Run Experience

## Purpose

A premium product must be installable by a new user without hand-holding. Browser Control should work from a clean checkout, an npm/global install path, and normal Windows/Linux/macOS shells.

This section hardens packaging, install docs, CLI bin behavior, and first-run setup.

## Scope

- Validate `package.json` metadata, `bin`, `files`, `exports`, dependency classification, and package identity.
- Ensure `bc` CLI works after install, not only from the repo.
- Test clean-machine setup flow with `bc setup`, `bc doctor`, `bc status`, `bc mcp serve`, and basic CLI help.
- Ensure `.env.example` and config docs match actual config keys.
- Add smoke tests for installed package layout.
- Add Windows PowerShell, Windows cmd, Linux shell, and macOS shell install instructions.
- Define minimum Node version and fail clearly when unsupported.
- Ensure generated config files are private where applicable.

## Non-Goals

- Do not publish to npm in this section unless explicitly requested.
- Do not add GUI installers.
- Do not require Chrome to be installed for terminal/filesystem-only mode.

## User-Facing Behavior

The following should work after installation:

```powershell
bc --help
bc doctor
bc setup --non-interactive
bc status --json
bc mcp serve
```

If browser automation cannot run because Chrome is absent, the product should report degraded browser capability while terminal/filesystem capabilities remain usable.

## Package Contract

The package should include:

- runtime TypeScript/compiled files needed by the CLI
- public docs needed for onboarding
- `.env.example`
- MCP setup docs
- no test fixtures or worktree artifacts unless required

If the project continues to run through `ts-node`, document that clearly. If it builds to `dist/`, make the package consume `dist/` consistently.

## Verification

- `npm run typecheck`
- `npm pack --dry-run`
- install packed tarball into a temporary project
- run CLI smoke tests from the installed tarball
- run `bc setup --non-interactive` in a temporary `BROWSER_CONTROL_HOME`
- run `bc doctor --json` and verify parseable JSON

## Success Criteria

- a new user can install and run basic commands from docs alone
- package contents are intentional
- first-run output is helpful and machine-readable where requested
- browser absence is degraded mode, not total product failure
