# Section 15: Remote Browser Provider Layer — Implementation Checklist

## Pre-Implementation
- [x] Read README.md, roadmap, reuse strategy, and Section 15 spec
- [x] Read all existing implementation files (browser_connection, browser_control, session_manager, MCP, CLI, etc.)
- [x] Update Section 15 worktree from current main (merged 5f8f8ea into section-15 branch)
- [x] Verify typecheck passes on baseline
- [x] Note test baseline (some Chrome-not-found failures in WSL, non-browser tests pass)

## Core Provider Abstraction
- [x] Create `providers/interface.ts` — BrowserProvider interface, ProviderCapabilities, connect/launch option types
- [x] Create `providers/types.ts` — ProviderConfig, ProviderRegistry, active provider selection types
- [x] Create `providers/errors.ts` — Provider-specific error classes for clear failure messages

## Provider Registry & Persistence
- [x] Create `providers/registry.ts` — JSON-backed registry, built-in inventory, load/save, get/list/select
- [x] Extend `paths.ts` — add provider registry file path under data home
- [x] Extend `config.ts` — expose active provider selection if appropriate (registry owns persistence)

## Provider Adapters
- [x] Create `providers/local.ts` — wrap current local launch/attach/restore/disconnect behavior
- [x] Create `providers/custom.ts` — generic remote CDP/WebSocket endpoint provider
- [x] Create `providers/browserless.ts` — proof-of-concept remote provider using configurable WS endpoint

## BrowserConnectionManager Integration
- [x] Refactor `browser_connection.ts` — make manager provider-aware internally
- [x] Manager remains facade; delegates provider-specific work to active/requested provider
- [x] Preserve public API shape (launchManaged, attach, restore, disconnect, getStatusSummary)
- [x] BrowserConnection records provider identity and optional providerMetadata
- [x] Persisted connection state reflects provider name
- [x] Policy evaluation and profile resolution stay in manager, not pushed into providers

## Session Model
- [x] Inspect `session_manager.ts` — ensure sessions bind to browser connections by ID only
- [x] Additive provider info only if needed; no provider-specific session schema bloat

## TypeScript API Surface
- [x] Extend `browser_control.ts` — add `bc.browser.provider.list()`, `bc.browser.provider.use(name)`, `bc.browser.provider.getActive()`
- [x] Update `index.ts` — export new public provider types and helpers

## CLI Commands
- [x] Extend `cli.ts` — add `bc browser provider list`
- [x] Extend `cli.ts` — add `bc browser provider use <name>`
- [x] Extend `cli.ts` — add `bc browser launch --provider <name>`
- [x] Extend `cli.ts` — add `bc browser attach --provider <name>`
- [x] Update help text

## MCP Tools
- [x] Create `mcp/tools/provider.ts` — `bc_browser_provider_list`, `bc_browser_provider_use`
- [x] Update `mcp/tool_registry.ts` — register provider tools cleanly
- [x] Update `mcp/types.ts` if new param schemas are needed

## Policy / Router
- [x] Inspect `execution_router.ts` and `policy.ts` — add minimal provider action routing/risk classification
- [x] Provider list/use/config reads: command path, low risk
- [x] Remote connect:honest browser attach/launch risk classification

## Tests
- [x] Create `providers/registry.test.ts` — registry load/save, active selection, corrupt fallback
- [x] Create `providers/local.test.ts` — local provider capabilities, launch/attach parity
- [x] Create `providers/custom.test.ts` — endpoint validation, capability surface
- [x] Create `providers/browserless.test.ts` — config validation, WS URL building
- [x] Extend `browser_connection.test.ts` — provider delegation, provider name in connection record
- [x] Extend `browser_control.test.ts` — provider API surface
- [x] Extend `cli.test.ts` — provider CLI commands
- [x] Extend `mcp/tool_registry.test.ts` — provider tools registered

## Verification
- [x] `npm run typecheck` passes
- [x] `npm test` passes (or matches baseline failures — no new regressions)
- [x] Review checklist completeness

## Final Report (orchestrator-only items — do not mark done)
- [x] Reuse decision documented
- [x] Intentional limitations listed
- [x] What later sections can build on top of this
