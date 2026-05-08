# Section 6: A11y Snapshot + Ref Layer — Implementation Checklist

## Phase 1: Core Types and Snapshot Generation

- [x] Create `a11y_snapshot.ts` with core types (A11yElement, A11ySnapshot, etc.)
- [x] Implement Playwright accessibility tree extraction
- [x] Implement DOM-based synthetic fallback snapshot
- [x] Implement tree flattening with ref assignment
- [x] Expose `snapshot()` function for a Playwright Page

## Phase 2: Ref Store

- [x] Create `ref_store.ts` with RefStore class
- [x] Implement deterministic ref assignment (e1, e2, e3...)
- [x] Implement ref lookup (by ref string)
- [x] Implement snapshot invalidation
- [x] Implement page-URL-change invalidation

## Phase 3: Semantic Query

- [x] Create `semantic_query.ts`
- [x] Implement query by role
- [x] Implement query by name
- [x] Implement query by state (disabled, checked, expanded, focused)
- [x] Implement composite queries (role + name)

## Phase 4: Snapshot Diffing

- [x] Create `snapshot_diff.ts`
- [x] Detect added elements
- [x] Detect removed elements
- [x] Detect renamed elements
- [x] Detect state changes
- [x] Detect route/title changes

## Phase 5: Integration

- [x] Integrate snapshot with `browser_core.ts`
- [x] Export new types and functions from `index.ts`

## Phase 6: Tests

- [x] Test snapshot generation from mock accessibility tree
- [x] Test synthetic fallback when accessibility tree is unavailable
- [x] Test deterministic ref assignment
- [x] Test ref lookup and invalidation
- [x] Test semantic query by role/name
- [x] Test snapshot diff (added/removed/renamed/state changed)
- [x] Test export surface

## Phase 7: Verification

- [x] Run targeted tests for new modules (44 tests, all pass)
- [x] Run `npm run typecheck` (0 new errors)
- [x] Run existing `browser_core.test.ts` (16 tests, all pass)
- [x] Run existing `policy_engine.test.ts` + `execution_router.test.ts` (54 tests, all pass)
- [x] Confirm no regressions in existing test suite

## Orchestrator-Only Items

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message
