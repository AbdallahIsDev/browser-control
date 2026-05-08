# Section 8: Real Browser, Profiles, and Session UX — Implementation Checklist

## Section

- Section: `08 — Real Browser, Profiles, and Session UX`
- Spec: `spec.md`
- Status: `implemented and merged`

## Implementation Tasks

### Core Abstractions
- [x] Create `browser_connection.ts` — connection mode types, BrowserProfile, BrowserConnection, AuthSnapshot interfaces
- [x] Create `browser_profiles.ts` — profile CRUD, isolation, path handling, defaults
- [x] Create `browser_auth_state.ts` — cookie/storage export, import, snapshot persistence

### Connection Modes
- [x] Implement managed automation browser connection (reuses existing launcher/CDP infra)
- [x] Implement attach-to-running-browser connection mode
- [x] Implement restored-session connection mode (rehydrate auth state into managed context)

### Profile Modes
- [x] Implement shared automation profile (persistent across runs)
- [x] Implement isolated temp profile (ephemeral, nothing persists)
- [x] Implement named persistent profiles (user-created)
- [x] Implement profile listing, creation, and deletion

### Auth / Session State
- [x] Implement cookie export from browser context
- [x] Implement cookie import into browser context
- [x] Implement localStorage export/import where practical
- [x] Implement auth snapshot save/load via MemoryStore
- [x] Integrate with existing `saveContextCookies` / `restoreContextCookies`

### Policy Integration
- [x] Register browser_attach as high-risk action
- [x] Register auth_export as high-risk action
- [x] Register auth_import as high-risk action
- [x] Register profile management as moderate-risk
- [x] Register browser_launch as moderate-risk
- [x] Integrate policy evaluation into connection operations

### Runtime Integration
- [x] Extend `paths.ts` with profiles directory helper
- [x] Update `index.ts` with new public exports
- [x] Integrate BrowserConnectionManager with existing `browser_core.ts` functions
- [x] Ensure backward compatibility — existing connectBrowser/createAutomationContext still work

### CLI Integration
- [x] Add `bc browser attach` command
- [x] Add `bc browser launch` command
- [x] Add `bc browser status` command
- [x] Add `bc browser profile list` command
- [x] Add `bc browser profile use <name>` command
- [x] Add `bc browser profile create <name>` command
- [x] Add `bc browser profile delete <name>` command
- [x] Add `bc browser auth export` command
- [x] Add `bc browser auth import` command

### Electron Support
- [x] Support Electron as a CDP attach target
- [x] Keep abstractions generic for Electron compatibility

### Tests
- [x] Create `browser_connection.test.ts`
- [x] Create `browser_profiles.test.ts`
- [x] Create `browser_auth_state.test.ts`
- [x] Test managed connection creation
- [x] Test attached connection behavior
- [x] Test profile mode selection/typing
- [x] Test auth/session persistence helpers
- [x] Test policy integration for browser lifecycle actions
- [x] Test config/path handling for profiles
- [x] Test failure behavior when attach target is missing
- [x] Test restored-mode common-case behavior

### Verification
- [x] Run targeted tests for new modules
- [x] Run npm run typecheck
- [x] Run npm test

## Notes

- Reuses existing `memory_store.ts` cookie helpers for auth snapshot persistence.
- Reuses existing `scripts/launch_browser.ts` for managed browser launch; BrowserConnectionManager orchestrates on top.
- Policy integration uses existing `DefaultPolicyEngine` and `ExecutionRouter`.
- Electron support is handled by the same CDP attach path — Electron is just another `target` type on BrowserConnection.
- Profile data directories live under `~/.browser-control/profiles/<profile-id>/`.

## Orchestrator-Only Completion

- [x] Section implementation reviewed and accepted by orchestrator
- [x] Changes committed and pushed by orchestrator with final commit message
