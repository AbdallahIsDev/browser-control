# Browser Control — Reuse Strategy

## Philosophy

Browser Control should not rebuild what the open-source ecosystem has already solved well. The goal is to be a **systems integrator and differentiator**, not a greenfield reimplementation of every browser/terminal/automation primitive.

The differentiators that Browser Control owns from scratch:
- Unified policy engine across browser, terminal, and file/system paths
- Unified execution router that selects the best path per task
- Shared browser/terminal/file-system session model
- Browser Control CLI/API/MCP surface
- Browser Control-specific orchestration, knowledge capture, and skill integration

Everything else should be evaluated for upstream reuse before being built.

---

## The Three Implementation Buckets

### Bucket 1: Adopt as Dependency

**When:** The upstream project is production-ready, well-maintained, TypeScript-native (or has clean bindings), and fits naturally into Browser Control's architecture without modification.

**Process:**
1. Verify the project is actively maintained (recent commits, responsive issues)
2. Check license compatibility (MIT, Apache 2.0, BSD are preferred)
3. Evaluate API surface stability (semver, no breaking changes every week)
4. Test integration with Browser Control's existing modules
5. Add as a dependency in `package.json`
6. Wrap behind a Browser Control adapter/interface if the upstream API is likely to change

**Examples of candidates:**
- MCP SDK (for MCP server implementation)
- node-pty (for terminal PTY sessions)
- Playwright (already a dependency)

### Bucket 2: Vendor / Copy and Adapt

**When:** The upstream project solves the hard part but needs:
- Translation to TypeScript (upstream is Python/Rust/Zig)
- Significant architectural modification to fit Browser Control's model
- Narrow extraction (we need one piece, not the whole project)
- Customization that would require forking the upstream repo

**Process:**
1. Study the upstream feature behavior, architecture, API shape, and data flow
2. Identify exactly which code/patterns are needed
3. Copy into `vendor/<source-project>/` with clear attribution
4. Translate to idiomatic Browser Control TypeScript — do not do blind line-by-line translation
5. Adapt interfaces to match Browser Control's types (ExecutionPath, RiskLevel, PolicyDecision, etc.)
6. Add a `vendor/<source-project>/PROVENANCE.md` documenting:
   - Source repo URL
   - Source commit/version
   - Source license
   - What was adapted and why
   - What was changed from the original
7. Isolate behind a Browser Control module that re-exports the vendored functionality through Browser Control's own interface

**What "do not copy blindly" means in practice:**
- Do not copy code you don't understand
- Do not copy upstream naming conventions that conflict with Browser Control's vocabulary
- Do not copy upstream architectural assumptions (e.g., single-path-only, no policy layer) into Browser Control's multi-path architecture
- Do not copy error handling patterns that assume a different runtime model
- Do copy: algorithms, data structures, state machines, interaction patterns, API ergonomics

### Bucket 3: Reimplement in Browser Control

**When:**
- The feature is a Browser Control differentiator (policy engine, execution router, session model)
- No suitable upstream exists
- Upstream solutions are too different architecturally to adapt meaningfully
- The implementation is simple enough that adaptation overhead exceeds reimplementation cost

**Process:**
1. Document why upstream reuse was not chosen (in the section spec's Reuse Plan)
2. Implement using Browser Control's conventions and types
3. Review upstream implementations for inspiration on edge cases and failure modes (even if not copying code)

---

## Handling Mixed-Language Upstream Sources

Many upstream projects are written in Python, Rust, or Zig. This is not a blocker.

**Approach:**
1. **Study the behavior first** — understand what the feature does, how it handles edge cases, what its API surface looks like, what its state model is
2. **Study the architecture** — how modules connect, what data flows where, what invariants are maintained
3. **Extract the design** — interfaces, state machines, algorithms, interaction patterns
4. **Translate into TypeScript** — write idiomatic Browser Control code that reproduces the behavior, not the syntax
5. **Preserve the invariants** — if the upstream code has correctness guarantees (e.g., "refs are deterministic per snapshot"), ensure the Browser Control implementation preserves them

**What NOT to do:**
- Do not reject an upstream solution because it's written in Python
- Do not do a literal line-by-line translation (Python idioms don't map to TypeScript idioms)
- Do not copy upstream dependency assumptions (e.g., Python's asyncio model doesn't map to Node.js event loop)
- Do not import upstream type systems or naming conventions wholesale

**What TO do:**
- Convert concepts, interfaces, state models, and interaction patterns into Browser Control TypeScript
- Adapt error handling to Browser Control's model (GuardrailError, ActionResult, etc.)
- Use Browser Control's logging, config, and path infrastructure instead of the upstream equivalents
- Test the adapted implementation against the same scenarios the upstream code handles

---

## Provenance and Licensing

### Before copying any code:
1. Check the upstream project's license
2. Verify compatibility with Browser Control's MIT license
3. MIT, Apache 2.0, BSD — compatible, proceed with attribution
4. GPL, AGPL, SSPL — do not copy code, study behavior only
5. No license / unclear — do not copy, ask upstream or study behavior only

### When vendoring:
1. Create `vendor/<source-project>/PROVENANCE.md` with:
   - Source repository URL
   - Source commit hash or version tag
   - Source license type
   - Date of extraction
   - What was extracted (files/modules/features)
   - What modifications were made
   - Attribution statement
2. Keep the vendored code in its own directory — do not mix into Browser Control's core modules
3. If the upstream license requires attribution in documentation, add it to the README

### When adapting behavior (not copying code):
1. Note the inspiration source in the section spec's Reuse Plan
2. No legal obligation for behavioral inspiration, but documenting sources improves maintainability

---

## Isolation Rules

Vendored or adapted code must be isolated:

1. **Vendored code** goes in `vendor/<source-project>/` — never in the root or core module directories
2. **Adapters** go in the normal module structure but import from `vendor/` — they translate between Browser Control's interfaces and the vendored code
3. **Browser Control modules** import from adapters, never directly from `vendor/`
4. **Tests** for vendored code verify the adapter behavior, not the vendored internals

This ensures:
- Upstream updates can be applied by replacing files in `vendor/`
- Browser Control's core types are never contaminated by upstream naming conventions
- The boundary between "our code" and "their code" is always clear

---

## When to Prefer Dependencies vs Vendoring

| Factor | Prefer Dependency | Prefer Vendor |
|---|---|---|
| Language | TypeScript/native JS | Python, Rust, Zig, or mixed |
| Maintenance | Active, responsive | Stale or slow-moving |
| Scope | We use most of it | We need one piece |
| Stability | Stable API, semver | Unstable, breaking changes likely |
| Size | Small/medium dependency | Large dependency with many transitive deps |
| Integration | Fits naturally | Needs significant adaptation |

---

## Browser Control's True Differentiators (Build From Scratch)

These are the pieces that make Browser Control unique. Do not outsource them:

1. **Policy Engine** — the unified permission model that governs browser, terminal, and file/system operations. No upstream project has this cross-surface policy layer.
2. **Execution Router** — the path selector that decides command vs a11y vs low-level per step. Browser Control's multi-path architecture is unique.
3. **Session Model** — the unified session that binds browser state + terminal state + policy profile + audit trail. No upstream project has this.
4. **CLI/API/MCP Surface** — the isomorphic action surface across three integration modes. This is Browser Control's brand.
5. **Knowledge System** — the compounding memory that captures reusable patterns from real runs. Browser Control-specific.
6. **Skill Orchestration** — the skill packaging, lifecycle, and state persistence model. Browser Control-specific.

Everything else — terminal rendering, browser CDP connection, MCP protocol, PTY management, URL resolution, remote browser providers — should be evaluated for upstream reuse first.
