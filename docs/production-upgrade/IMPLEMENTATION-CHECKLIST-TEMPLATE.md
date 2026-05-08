# Implementation Checklist Template

Copy this file into a section folder as:

- `implementation-checklist.md`

Then replace the placeholders with section-specific work items.

## Section

- Section: `[section-number and name]`
- Spec: `spec.md`
- Status: `not started | in progress | blocked | ready for orchestrator review`

## Implementation Tasks

- [ ] Read `spec.md` and identify the concrete code entry points
- [ ] Identify existing files/modules that must be extended
- [ ] Implement the first core sub-feature
- [ ] Implement the next sub-feature
- [ ] Integrate with existing runtime/session/config behavior
- [ ] Add or update tests for the section
- [ ] Run targeted verification for the changed area
- [ ] Run broader verification required by the section

## Notes

- Add short notes here only when they help explain blockers, scope decisions, or follow-up work.
- Keep this file current while implementation is happening.

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
