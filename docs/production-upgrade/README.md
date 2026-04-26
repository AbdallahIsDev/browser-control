# Browser Control Production Upgrade

This folder is the working spec area for turning the Browser Control roadmap into implementation-ready feature sections.

## Purpose

The source of truth for product direction lives in:

- `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md`

Some section worktrees may not carry `docs/specs/`. If the roadmap file is absent, record that in the section checklist and use this folder's `STATUS.md` plus the target section `spec.md` as the available local source of truth.

This folder exists to break that roadmap into section-by-section specs that are detailed enough for a future AI agent to generate fresh implementation prompts based on the latest repo state.

## Current Implementation Status

Use `STATUS.md` as the canonical source of truth for which production-upgrade sections are implemented, merged, or still pending.

The short version as of the latest synchronization:

- Sections 4 through 15 are implemented and merged into `main`.
- Section 16 is not implemented yet.
- Section-specific `implementation-checklist.md` files are execution artifacts; when their historical checkbox state conflicts with `STATUS.md`, `STATUS.md` wins.

## What Belongs Here

Each v1 roadmap section should have its own folder:

- `section-XX-feature-name/`

Example:

- `section-05-agent-action-surface/`
- `section-06-accessibility-snapshot-ref-layer/`

Inside each section folder, create exactly one file:

- `spec.md`

When active implementation of a section begins, create one additional file inside that same section folder:

- `implementation-checklist.md`

This file is not a fixed prompt. It is a live execution checklist for that one section.

## What `spec.md` Should Contain

Each section spec should describe the feature in a durable way, including:

- purpose
- scope
- non-goals
- user-facing behavior
- agent-facing behavior
- architecture/design
- likely modules/components
- data models/interfaces if relevant
- session/state implications
- permissions/guardrails implications
- failure/recovery behavior
- CLI/API/MCP implications
- dependencies on other sections
- risks/tradeoffs
- success criteria

The spec should explain the feature clearly, but it should not freeze a fixed implementation prompt.

## Reuse-First Implementation Strategy

Browser Control does not default to greenfield implementation. Before writing new code for any section, evaluate whether the feature or pattern already exists in an upstream open-source project.

Read `REUSE-STRATEGY.md` for the full methodology. The short version:

Every new capability should be classified into one of three buckets:

1. **Adopt as dependency** — the upstream project is production-ready, well-maintained, and fits naturally. Add it as a dependency.
2. **Vendor / copy and adapt** — the upstream project solves the hard part but needs significant modification, translation to TypeScript, or architectural adaptation. Copy the relevant code/patterns into `vendor/` with provenance tracking.
3. **Reimplement in Browser Control** — the feature is a Browser Control differentiator or no suitable upstream exists. Build it natively.

Key rules:
- Evaluate upstream sources before writing new code
- Mixed-language upstream sources (Python, Rust, Zig) are acceptable inputs — translate behavior into TypeScript
- Do not copy blindly — understand the feature behavior and architecture first
- Isolate vendored/adapted code behind adapters, not spread randomly
- Browser Control-specific abstractions (policy engine, execution router, session model, CLI/API/MCP surface) remain the source of truth
- Track provenance and check license compatibility before copying

See `UPSTREAM-SOURCES.md` for the catalog of evaluated upstream projects and their recommended reuse modes per section.

## Important Rules

- Do not create `prompt.md`, `implementation-prompt.md`, `tasks.md`, or similar fixed instruction files.
- Do not write stale step-by-step prompts for another AI.
- Do not duplicate the roadmap into multiple competing documents.
- Do not implement code from this folder directly unless explicitly asked.
- When a section moves from planning to implementation, the coding agent should create and maintain `implementation-checklist.md` inside that section folder.
- Keep the specs aligned with the Browser Control vision:
  - unified automation engine
  - command path
  - a11y path
  - low-level fallback
  - browser + native terminal + file/system operations
  - permissions as a first-class core layer

## Implementation Checklist Workflow

When implementing a section:

1. Read the roadmap, this README, and the target section's `spec.md`.
2. Create `implementation-checklist.md` inside the target section folder.
3. Break the section into concrete implementation to-dos using Markdown checkboxes.
4. Mark sub-items as `[x]` only after the code is implemented and locally verified.
5. Keep the checklist current during the implementation run.

The checklist should contain:

- concrete implementation tasks
- verification tasks
- any clearly defined sub-features or integration steps
- a final orchestrator-only acceptance item
- a final orchestrator-only commit/push item

### Coding Agent Rules

The coding agent may:

- create `implementation-checklist.md`
- add detailed section-specific implementation tasks
- mark completed implementation sub-tasks as `[x]`
- add new sub-tasks if the work reveals missing implementation steps

The coding agent must not mark the final orchestrator-only completion items as done.

### Orchestrator Rules

The orchestrator reviews the implementation result and is the only role that should mark the final completion items as done.

Those final items are:

- `[ ] Section implementation reviewed and accepted by orchestrator`
- `[ ] Changes committed and pushed by orchestrator with final commit message`

## Checklist Template

Use:

- `docs/production-upgrade/IMPLEMENTATION-CHECKLIST-TEMPLATE.md`

as the standard starting structure for each section's `implementation-checklist.md`.

## How Future Agents Should Use This Folder

1. Read the roadmap in `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md`.
2. Read this file.
3. Read the relevant section folder's `spec.md`.
4. If implementing the section, create/update `implementation-checklist.md` using the template and the current repo state.
5. Inspect the current repository state.
6. Generate a fresh implementation prompt or plan based on the latest codebase, not based on a fixed prompt file.

## Why This Structure Exists

The goal is to keep the specs durable and the implementation instructions dynamic.

That way, if the codebase changes, the next AI agent can still produce the right implementation approach from the current repo state instead of following an outdated frozen prompt.
