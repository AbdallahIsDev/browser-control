# Implementation Checklist

## Section

- Section: 09 — Knowledge System
- Spec: `spec.md`
- Status: completed

## Implementation Tasks

- [x] Create implementation checklist
- [x] Define core knowledge types (`knowledge_types.ts`)
- [x] Add knowledge path helpers to `paths.ts`
- [x] Create knowledge directory on startup in `ensureDataHomeAtPath`
- [x] Implement knowledge store — read/write/validate markdown files (`knowledge_store.ts`)
- [x] Implement knowledge validator — missing fields, secrets, stale refs (`knowledge_validator.ts`)
- [x] Implement knowledge query/search helpers (`knowledge_query.ts`)
- [x] Add CLI commands: list, show, validate, prune (`cli.ts`)
- [x] Export knowledge system from `index.ts`
- [x] Add tests for knowledge store
- [x] Add tests for knowledge validator
- [x] Add tests for knowledge query
- [x] Add tests for knowledge CLI commands
- [x] Run targeted knowledge module tests
- [x] Run `npm run typecheck`
- [x] Run `npm test`

## Notes

- Markdown files with YAML frontmatter are canonical (per spec).
- Interaction skills: reusable browser interaction patterns (dialogs, iframes, etc.).
- Domain skills: site-specific knowledge (selectors, quirks, wait conditions).
- Secret detection must catch tokens, passwords, API keys in knowledge content.
- Query helpers derive an in-memory index from markdown files — no separate JSON index for v1.

## Orchestrator-Only Completion

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message
