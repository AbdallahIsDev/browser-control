# Section 9: Knowledge System

## Purpose
Browser Control should learn durable knowledge from real runs so future runs are faster and less flaky. This is the long-term compounding layer — the system gets smarter every time it runs.

## Why This Section Matters to Browser Control
Without knowledge capture, every run on a known site starts from scratch. The agent re-discovers selectors, re-encounters quirks, re-falls-into the same pitfalls. With a knowledge system, the second run on a site is faster and more reliable than the first. Over time, the system develops reusable site memory that any AI agent can consume.

## Scope
- Reusable interaction mechanics (dialogs, dropdowns, iframes, uploads, downloads, infinite scroll, shadow DOM, login walls)
- Reusable domain/site knowledge (stable selectors, route patterns, hidden pitfalls, waits, API endpoints, navigation shortcuts, DOM quirks, framework-specific behavior)
- Agent-readable and human-readable knowledge file format
- Capture triggers during execution
- Knowledge consumer behavior (search before executing)
- Validation rules for stored knowledge (lint for missing fields, secrets, duplicates, stale refs)

## Non-Goals
- Do not turn this into a giant prompt dump
- Do not save everything — only durable, repeatable, safe observations
- Do not confuse site knowledge with session-specific state
- Do not store tokens, cookies, user-specific content, or step-by-step diaries

## User-Facing Behavior
- Knowledge is captured automatically during runs (no user action needed)
- User can inspect knowledge: `bc knowledge list`, `bc knowledge show <site>`
- User can validate knowledge files: `bc knowledge validate`
- User can clear stale knowledge: `bc knowledge prune <site>`

## Agent-Facing Behavior
- Before starting work on a known domain, agent searches domain knowledge
- Agent applies known interaction patterns automatically
- Agent only re-discovers if stored knowledge fails or is missing
- Agent can explicitly contribute new knowledge when it solves a non-obvious interaction

## Architecture/Design

### Knowledge Types

**interaction-skills/** — reusable patterns:
- How to handle modal dialogs across sites
- How to interact with dropdowns/selects
- How to work within iframes
- How to handle file upload/download flows
- How to deal with infinite scroll
- How to pierce shadow DOM
- How to pass through login walls
- How to handle browser-rendered terminals

**domain-skills/** — site-specific knowledge:
- Stable selectors for known sites
- Route patterns (URL → page type mapping)
- Hidden pitfalls (e.g., "this site has a 3-second delay before the submit button activates")
- Optimal wait conditions
- API endpoints the site uses
- Navigation shortcuts
- DOM quirks specific to the site's framework

### Storage Format
The canonical artifact is a Markdown skill document with structured frontmatter, stored under `~/.browser-control/knowledge/`:
```
knowledge/
├── interaction-skills/
│   ├── modal-dialogs.md
│   ├── iframe-navigation.md
│   └── file-upload.md
└── domain-skills/
    ├── github.com.md
    ├── framer.com.md
    └── contributor.stock.adobe.com.md
```

Markdown is the source of truth because it is durable, diffable, readable by humans, and directly usable by future AI agents. If Browser Control later maintains a structured search index, that index is derived from these Markdown files rather than replacing them.

### Knowledge Entry Structure
```md
---
domain: github.com
capturedAt: 2026-04-20T10:00:00Z
kind: domain-skill
---

# github.com

## Stable Selectors
- PR merge button
  - selector: `[data-test-id="merge-button"]`
  - role: `button`
  - name: `Merge pull request`
  - verified: true
  - lastVerified: 2026-04-20

## Pitfalls
- Actions dropdown can take ~2 seconds to appear after click
  - waitCondition: `role=menu`
  - waitMs: 2500

## Navigation Shortcuts
- Repo settings URL pattern:
  - `https://github.com/{owner}/{repo}/settings`
```

### Capture Triggers
Knowledge capture fires when:
- Agent solves a non-obvious interaction (e.g., discovers an iframe that wasn't visible)
- A selector needed stabilization (initial selector failed, retry with different selector succeeded)
- A site had a hidden quirk (delayed render, unusual focus behavior)
- A wait condition was discovered empirically
- A reliable shortcut was found
- A low-level fallback was necessary and should be avoidable next time

### Consumer Behavior
Before starting work on a known domain:
1. Search domain knowledge for the target domain
2. Search interaction knowledge for relevant patterns
3. Apply known patterns to the current task
4. Only rediscover if stored knowledge fails or is missing
5. If rediscovery succeeds where stored knowledge failed, update the knowledge entry

### Validation
Knowledge files are linted for:
- Missing required fields
- Secrets accidentally stored (tokens, passwords, API keys)
- Invalid examples (selectors that don't match expected format)
- Duplicate entries
- Stale references (selector verified >30 days ago)

## Core Components/Modules
- `knowledge/store.ts` — read/write/validate Markdown knowledge files
- `knowledge/capture.ts` — capture triggers during execution
- `knowledge/consumer.ts` — search and apply knowledge before execution
- `knowledge/validator.ts` — lint knowledge files for issues
- `knowledge/index.ts` — optional derived search index built from Markdown knowledge files

## Data Models/Interfaces
```typescript
interface KnowledgeEntry {
  type: "stable-selector" | "pitfall" | "wait-condition" | "navigation-shortcut" | "api-endpoint" | "dom-quirk";
  description: string;
  selector?: string;
  role?: string;
  name?: string;
  waitCondition?: string;
  waitMs?: number;
  pattern?: string;
  verified: boolean;
  lastVerified: string;
  capturedAt: string;
}

interface DomainKnowledge {
  domain: string;
  entries: KnowledgeEntry[];
  capturedAt: string;
  lastUsedAt: string;
}
```

## Session/State Implications
- Knowledge is global, not session-specific — it persists across all sessions
- Knowledge is domain-scoped — each domain has its own knowledge file
- Knowledge capture happens during session execution but the knowledge is stored globally
- Knowledge does not contain session-specific state (cookies, current URL, etc.)

## Permissions/Guardrails Implications
- Knowledge capture is `low` risk (read-only observation of DOM structure)
- Knowledge files must never contain secrets — validator enforces this
- Knowledge files are stored in the user's data directory — not shared by default
- Sharing knowledge (future marketplace) would require additional sanitization

## Failure/Recovery Behavior
- If a knowledge file is corrupt, skip it and log a warning — don't crash
- If knowledge leads to a failed action (stale selector), invalidate the entry and re-discover
- If capture trigger fires but capture fails (disk full, permissions), log warning and continue — capture failure should never block execution

## CLI/API/MCP Implications
- CLI: `bc knowledge list` — show all domains with knowledge
- CLI: `bc knowledge show <domain>` — show knowledge entries for a domain
- CLI: `bc knowledge validate` — lint all knowledge files
- CLI: `bc knowledge prune <domain>` — remove stale entries
- MCP: `bc_knowledge_search` — search knowledge for a domain
- API: `bc.knowledge.search(domain)`, `bc.knowledge.capture(entry)`

## Browser/Terminal/FileSystem Path Implications
- Knowledge is primarily browser-focused (selectors, DOM quirks, wait conditions)
- Terminal knowledge could include: shell-specific command patterns, prompt detection quirks
- Filesystem knowledge is less relevant (operations are already deterministic)
- Knowledge capture only triggers during browser and terminal path execution

## Dependencies on Other Sections
- **Depends on:** Section 5 (Agent Action Surface) — knowledge is captured during action execution
- **Depends on:** Section 6 (A11y Snapshot) — knowledge references elements by role/name/ref
- **Supports:** Section 4 (Policy Engine) — knowledge could inform risk classification (known-dangerous selectors)
- **Supports:** Section 10 (Observability) — knowledge validation is a health check

## Risks/Tradeoffs
- **Risk:** Stale knowledge causes more harm than no knowledge. Mitigation: validation catches stale entries, agent re-discovers on failure, expiry timestamps.
- **Risk:** Knowledge files grow too large. Mitigation: per-domain files, pruning command, entry limits.
- **Risk:** Knowledge capture adds overhead to every run. Mitigation: capture is opportunistic (only when interesting), not exhaustive.
- **Tradeoff:** Global knowledge means one session's learning benefits all sessions. Accepted — this is the compounding value.

## Open Questions
- Should knowledge entries have confidence scores? Recommendation: start with boolean verified/unverified, add confidence post-v1.
- Should Browser Control maintain a derived JSON index for fast lookup? Recommendation: yes if search performance becomes an issue, but the Markdown files remain canonical.

## Implementation Tracking
- When implementation of this section starts, create `implementation-checklist.md` in this folder.
- The coding agent should break the section into concrete checkbox tasks and update that file during implementation.
- The coding agent may mark section sub-tasks as `[x]` only after the code and local verification for that sub-task are done.
- The coding agent must not mark the final orchestrator-only completion items as done.
- The checklist must end with these orchestrator-only items:
  - `[ ] Section implementation reviewed and accepted by orchestrator`
  - `[ ] Changes committed and pushed by orchestrator with final commit message`

## Reuse Plan

**Strategy: Study browser-harness concept, adapt into Browser Control architecture.**

The knowledge system concept — reusable interaction patterns and domain-specific knowledge — is inspired by **browser-harness**'s approach to interaction-skills and domain-skills.

**Upstream sources:**
- **browser-harness** — the interaction-skill/domain-skill concept, durable knowledge capture from real runs.

**What to reuse:**
- The concept of interaction-skills (reusable patterns for dialogs, dropdowns, iframes, uploads, etc.)
- The concept of domain-skills (site-specific knowledge: selectors, quirks, wait conditions)
- Knowledge capture triggers (non-obvious interactions, selector stabilization, hidden quirks)
- Knowledge consumer behavior (search before executing)

**What NOT to reuse:**
- Do not blindly inherit browser-harness's "ultra-thin harness" philosophy unless it fits Browser Control's architecture
- Do not inherit upstream's assumptions about self-editing or auto-modification
- Do not import upstream's storage format — adapt to Browser Control's data directory model
- Do not assume knowledge is browser-only — Browser Control could have terminal knowledge too

**Mixed-language note:** If browser-harness is not TypeScript, study the conceptual model and knowledge structure, then implement in Browser Control's TypeScript with its own storage and validation patterns.

## Implementation Success Criteria
- Repeated tasks on known domains get measurably faster (fewer re-discoveries)
- Low-level fallbacks decrease on domains with stored knowledge
- The system develops reusable site memory that survives across sessions
- Another AI agent can read a knowledge file and use it immediately without re-discovery
- Knowledge files pass validation (no secrets, no missing fields, no stale refs)
- Knowledge capture never blocks or slows down the primary task execution
