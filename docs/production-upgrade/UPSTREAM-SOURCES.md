# Upstream Sources Catalog

This document catalogs evaluated upstream projects and their recommended reuse modes per Browser Control section. Updated as new upstream sources are evaluated.

---

## Evaluated Projects

### chrome-devtools-mcp
- **Repo:** https://github.com/ChromeDevTools/chrome-devtools-mcp
- **Language:** TypeScript
- **License:** Apache-2.0 (verified from repository LICENSE file)
- **What it does:** MCP server exposing Chrome DevTools protocol as agent tools
- **Relevant sections:** 07 (MCP), 08 (Browser), 10 (Observability)
- **Recommended mode:** Study patterns, adapt tool naming/schema conventions. Do not wrap directly — Browser Control's MCP surface spans browser + terminal + file/system, not just DevTools.
- **Notes:** Tool structure and MCP server patterns are valuable references. Browser Control should borrow good ideas but expose its own higher-level model.

### agent-browser
- **Repo:** https://github.com/vercel-labs/agent-browser
- **Language:** TypeScript + Rust
- **License:** Apache-2.0 (verified from repository LICENSE file)
- **What it does:** Browser automation for AI agents with accessibility-first approach
- **Relevant sections:** 05 (Action Surface), 06 (A11y Snapshot)
- **Recommended mode:** Vendor/adapt for Section 06. The snapshot → ref → action model is strongly relevant. Rust components need TypeScript translation.
- **Notes:** The conceptual model (a11y snapshot with stable refs, ref-based interaction) should heavily inform Browser Control's approach. Implementation details in Rust need translation.

### browser-use
- **Repo:** https://github.com/browser-use/browser-use
- **Language:** Python
- **License:** MIT (verified from repository LICENSE file)
- **What it does:** Python library for browser automation by AI agents
- **Relevant sections:** 05 (Action Surface), 08 (Browser), 11 (Operator UX), 15 (Remote Provider), 16 (Benchmarks)
- **Recommended mode:** Study patterns, adapt action ergonomics and operator UX shapes. Python implementation needs TypeScript translation. Do not import Python assumptions.
- **Notes:** Action naming, browser interaction patterns, and setup/doctor UX are valuable references. The multi-provider concept informs Section 15.

### browser-harness
- **Repo:** https://github.com/browser-use/browser-harness
- **Language:** TypeScript
- **License:** MIT (verified from repository LICENSE file)
- **What it does:** Minimal browser harness for agent interaction
- **Relevant sections:** 09 (Knowledge), 12 (Terminal)
- **Recommended mode:** Study the interaction-skill/domain-skill concept for Section 09. Adapt the concept into Browser Control's architecture. Do not inherit the "ultra-thin harness" philosophy unless it fits.
- **Notes:** The knowledge capture concept (reusable interaction patterns, domain-specific knowledge) is relevant. Adapt to Browser Control's session/policy model.

### wterm
- **Repo:** https://github.com/vercel-labs/wterm
- **Website:** https://wterm.dev/
- **Language:** TypeScript/JS (terminal rendering)
- **License:** Apache-2.0 (verified from repository LICENSE file)
- **What it does:** Browser-rendered terminal with semantic structure
- **Relevant sections:** 06 (A11y Snapshot — terminal a11y), 12 (Terminal), 13 (Terminal Resume)
- **Recommended mode:** Vendor/adapt terminal rendering layer. Browser Control should not rebuild terminal rendering from scratch. The a11y-exposed terminal content is directly relevant to Section 06's terminal snapshot concept.
- **Notes:** Browser-rendered terminal a11y snapshots bridge the terminal and browser paths. wterm's approach to exposing terminal content as semantic DOM should be adapted.

### portless
- **Repo:** https://github.com/vercel-labs/portless
- **Language:** TypeScript
- **License:** Apache-2.0 (verified from repository LICENSE file)
- **What it does:** Stable local URLs for development
- **Relevant sections:** 14 (Stable Local URLs)
- **Recommended mode:** Dependency-first or wrapper-first. Do not rebuild this feature from scratch — portless (or similar) solves it already.
- **Notes:** Almost certainly a dependency candidate. Only reimplement if integration with Browser Control's session/daemon model forces it.

---

## Section → Source Mapping (Summary)

| Section | Primary Sources | Recommended Mode |
|---|---|---|
| 04 Policy Engine | None (differentiator) | Reimplement — Browser Control owns this |
| 05 Action Surface | browser-use, agent-browser | Study/adapt action naming and ergonomics |
| 06 A11y Snapshot | agent-browser | Vendor/adapt snapshot → ref → action model |
| 07 MCP Integration | chrome-devtools-mcp | Study/adapt MCP tool patterns, own the tool model |
| 08 Browser Profiles | browser-use, chrome-devtools-mcp | Study/adapt attach/profile/session patterns |
| 09 Knowledge System | browser-harness | Study/adapt interaction-skill concept |
| 10 Observability | chrome-devtools-mcp, DevTools | Study/adapt debugging concepts |
| 11 Operator UX | browser-use | Study/adapt doctor/setup/config patterns |
| 12 Terminal | wterm, browser-harness | Vendor/adapt rendering layer, own orchestration |
| 13 Terminal Resume | wterm, terminal ecosystem | Study/adapt serialization patterns, own resume semantics |
| 14 Stable URLs | portless | Dependency-first |
| 15 Remote Provider | browser-use, provider SDKs | Wrap providers, own abstraction |
| 16 Benchmarks | browser-use, upstream examples | Study/adapt structure, write Browser Control examples |

---

## License Compatibility Summary

| Project | License | Compatible with Browser Control (MIT)? |
|---|---|---|
| chrome-devtools-mcp | Apache-2.0 | Yes |
| agent-browser | Apache-2.0 | Yes |
| browser-use | MIT | Yes |
| browser-harness | MIT | Yes |
| wterm | Apache-2.0 | Yes |
| portless | Apache-2.0 | Yes |

All evaluated upstream sources are license-compatible with Browser Control's MIT license. MIT and Apache-2.0 both permit vendoring and adaptation with attribution.

Before vendoring or copying code from any source above:
1. Verify the current license at the time of extraction (licenses can change)
2. Preserve attribution where required
3. All vendored code must include a `PROVENANCE.md` file (see REUSE-STRATEGY.md for template)
