# Section 17: Repository Architecture and Codebase Cleanup

## Purpose

Browser Control has reached feature-complete v1 core, but the repository still feels like a fast-moving implementation workspace. A premium product needs a codebase that is easy to navigate, easy to review, and hard to accidentally break.

This section turns the current root-heavy layout into a clear product structure without changing public behavior.

## Scope

- Reduce root-level TypeScript/module clutter by moving related modules into focused folders.
- Establish a documented source layout for browser, terminal, filesystem, policy, MCP, providers, services, observability, operator UX, config, runtime, and shared utilities.
- Split oversized files only when it reduces responsibility overlap and improves testability.
- Remove or relocate stale scripts, temporary artifacts, and historical review leftovers.
- Preserve all public imports from `index.ts` and existing CLI/API/MCP behavior.
- Keep Git history understandable with small migration commits.

## Non-Goals

- Do not rewrite architecture for taste alone.
- Do not change user-facing command names, MCP tool names, or API method names.
- Do not remove compatibility exports unless Section 23 explicitly deprecates them.
- Do not perform large behavior changes while moving files.

## Target Structure

Suggested direction:

- `src/browser/` or `browser/`: browser connection, actions, profiles, auth, launch helpers.
- `terminal/`: terminal session, exec, prompt, snapshot, resume, serialization.
- `filesystem/` or `fs/`: native fs operations and fs action wrappers.
- `policy/`: policy engine, router, risk taxonomy.
- `mcp/`: MCP server, registry, tool wrappers.
- `providers/`: browser provider abstraction and adapters.
- `services/`: stable local URL registry/resolver/detector.
- `observability/`: debug bundles, redaction, capture, recovery, performance.
- `operator/`: doctor/setup/status/config formatting.
- `runtime/`: daemon, broker, cleanup, process launch helpers.
- `shared/`: action result, logger, config, paths, shared types.

The exact structure should follow current import patterns and minimize churn. If moving everything into `src/` creates excessive breakage, keep top-level feature folders but move only root files that are clearly misplaced.

## User-Facing Behavior

No user-facing behavior should change. The cleanup is successful only if existing CLI/API/MCP usage still works.

## Agent-Facing Behavior

Agents should be able to understand the codebase quickly:

- each feature folder has a narrow responsibility
- public exports remain discoverable from `index.ts`
- tests live near the behavior they verify or are named clearly at repo root
- docs explain where to implement future sections

## Architecture and Design

Create an inventory before moving files:

1. root files and their current dependencies
2. public exports from `index.ts`
3. CLI imports
4. MCP imports
5. tests and path aliases

Use TypeScript path compatibility carefully. Prefer relative import updates over introducing opaque aliases unless the repo already standardizes them.

## Failure and Recovery

- If a move creates broad test failures, revert that move and split it into smaller steps.
- Keep compatibility re-export files where needed.
- Do not leave duplicate implementations behind.

## Verification

- `npm run typecheck`
- targeted tests for moved modules
- full `npm test` where practical
- `node --require ts-node/register --require tsconfig-paths/register --test mcp/tool_registry.test.ts`
- CLI smoke checks for `bc --help`, `bc status --json`, `bc config list --json`

## Success Criteria

- root-level clutter is materially reduced
- module ownership is documented
- all existing public behavior remains compatible
- typecheck and relevant tests pass
- future agents can find the right file without reading the whole repo
