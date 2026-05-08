# Section 24: Repository Structure and Module Organization

## Purpose

Browser Control now has the feature set expected from a serious automation product, but the repository still carries too much root-level implementation clutter. This section makes the codebase feel like a maintainable product: clear folders, predictable module ownership, stable public entrypoints, and an obvious path for future contributors and AI agents.

The goal is not cosmetic churn. The goal is to reduce onboarding cost, lower merge risk for future sections, and make package/public compatibility harder to break accidentally.

## Scope

- Move root-level TypeScript implementation files into a deliberate `src/` structure.
- Move root-level tests into a deliberate `tests/` structure, or document and standardize any tests that must remain at root.
- Preserve CLI behavior, TypeScript public exports, MCP tool names/schemas, persisted file formats, and package install behavior.
- Keep compatibility shims where needed so existing public imports continue to work.
- Update `tsconfig`, package exports/bin paths, build scripts, test scripts, compatibility snapshots, and docs after moves.
- Add or update tests that prove public API compatibility after the restructure.
- Document the final source layout so future agents know where new code belongs.

## Non-Goals

- Do not rewrite business logic while moving files.
- Do not rename public CLI commands, MCP tools, or API methods.
- Do not remove public exports unless they are already deprecated by Section 23 and covered by a compatibility note.
- Do not introduce a monorepo unless the current package layout truly requires it.
- Do not convert module systems or change runtime targets as part of this section.
- Do not mix unrelated cleanup, feature additions, or behavior changes into this branch.

## Target Structure

Preferred final direction:

```text
browser-control/
  src/
    browser/
    cli/
    config/
    filesystem/
    knowledge/
    mcp/
    observability/
    operator/
    policy/
    providers/
    runtime/
    services/
    shared/
    terminal/
    index.ts
  tests/
    unit/
    integration/
    e2e/
    compatibility/
    fixtures/
  docs/
  scripts/
  examples/
  test-fixtures/
  package.json
  tsconfig.json
  README.md
```

If moving every file at once creates excessive risk, the implementation may use a phased structure with `src/` for production code first and a smaller test migration second. The final branch must still materially reduce root clutter and document the remaining exceptions.

## Required Inventory Before Moving

The implementation must create a short inventory in the checklist before edits:

- root `.ts` and `.test.ts` files
- package entrypoints and `bin` scripts
- TypeScript public exports from `index.ts`
- CLI imports and runtime bootstrap paths
- MCP imports and tool registry paths
- e2e and compatibility test paths
- generated snapshots and fixtures
- docs that reference moved paths

## Public Compatibility Requirements

These must remain compatible:

- `import { createBrowserControl } from "browser-control"`
- package root `index.ts` / built package exports
- `bc` CLI command and all documented subcommands
- MCP tool registry names and schemas
- config keys and `.env.example`
- persisted service/provider/debug/terminal formats
- golden workflow runner commands

Compatibility shims are allowed when they reduce migration risk. If shims are added, document whether they are permanent public entrypoints or temporary internal bridges.

## Architecture Rules

- Use folder boundaries that match product responsibilities, not arbitrary technical layers.
- Keep modules small enough that future agents can understand one responsibility at a time.
- Prefer direct relative imports inside nearby modules unless the repo already has a stable path alias.
- Avoid circular dependencies introduced by barrel files.
- Keep `src/index.ts` as the public API aggregation point.
- Keep side-effect-heavy startup code out of public import paths.
- Keep tests close enough to discover behavior, but avoid scattering root-level test files.

## CLI/API/MCP Implications

- CLI bin scripts must still work from source and from packed npm artifacts.
- MCP stdio must stay clean: no logs or startup output on stdout.
- The TypeScript API should continue to expose the same public surface snapshots.
- Any changed import paths must be reflected in docs and examples.

## Testing and Verification

Minimum required verification:

- `npm run typecheck`
- `npm run test:ci`
- `npm run test:mcp`
- `npm run test:e2e`
- `npm run compat:test`
- `npm run docs:check`
- `npm run test:package`
- `npm run package:smoke`

Also run focused tests after each migration slice. Do not wait until the end to discover broad import breakage.

## Risks and Guardrails

- This is high-conflict work. Do it in one dedicated worktree and avoid mixing other feature branches.
- Moving files without compatibility tests can silently break users.
- Barrel exports can create circular imports. Check for runtime import failures, not just typecheck.
- Package smoke tests are mandatory because source tests may pass while packed artifacts break.
- If a migration slice causes many unrelated failures, revert that slice and split it smaller.

## Success Criteria

- Root-level implementation/test clutter is materially reduced.
- Source folders have clear ownership and are documented.
- Public package/API/CLI/MCP behavior remains compatible.
- Full required verification passes from the new structure.
- Future implementation prompts can point agents to clear folders instead of a flat root.
