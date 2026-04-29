# Section 26: Agentic Screencast and Debug Receipts - Implementation Checklist

## Overview
This document provides a comprehensive checklist of the implementation of Section 26: Agentic Screencast and Debug Receipts for Browser Control.

## Implementation Summary

### 1. Observability Types (src/observability/types.ts)
- [x] Added `ScreencastStatus` type: "recording" | "stopped" | "failed"
- [x] Added `ScreencastSession` interface with fields:
  - id, browserSessionId, pageId, path, startedAt, stoppedAt
  - status, actionAnnotations, retention, mode
- [x] Added `ScreencastOptions` interface with fields:
  - path?, showActions?, annotationPosition?, retention?
- [x] Added `ActionReceiptEvent` interface for timeline entries:
  - timestamp, action, target?, url?, title?
  - policyDecision?, risk?, durationMs?, artifactPath?
  - success?, error?
- [x] Added `DebugReceipt` interface with fields:
  - taskId, receiptId, status, startedAt, completedAt
  - artifacts[], timelinePath?, screencastPath?
- [x] Extended `DebugBundleBrowserEvidence` with:
  - screencastPath?, receiptPath?, timelinePath?

### 2. Artifact Path Helpers (src/shared/paths.ts)
- [x] Added `getSessionScreencastDir(sessionId)`: Returns screencast directory path
- [x] Added `ensureSessionScreencastDir(sessionId)`: Creates screencast directory
- [x] Added `getSessionReceiptDir(sessionId)`: Returns receipt directory path
- [x] Added `ensureSessionReceiptDir(sessionId)`: Creates receipt directory
- [x] Added `isSafeArtifactPath(path)`: Validates path is within data home

### 3. Screencast Recorder Module (src/observability/screencast.ts)
- [x] Created `ScreencastRecorder` class with methods:
  - `start(options)`: Starts screencast recording
  - `stop()`: Stops recording and generates receipt
  - `status()`: Returns current session status
  - `appendEvent(event)`: Adds event to timeline
  - `saveTimeline(sessionId)`: Saves timeline to file
  - `generateReceipt(sessionId, timelinePath)`: Creates DebugReceipt
  - `applyRetention(sessionId)`: Cleans up artifacts based on policy
  - `loadSession(sessionId)`: Loads session from store
  - `loadReceipt(receiptId)`: Loads receipt from file
  - `pruneOldArtifacts()`: Removes old artifacts
- [x] Recording modes:
  - native: Playwright screencast API
  - frames: Screenshot frame capture fallback
  - metadata-only: Timeline only (no video)
- [x] Action annotation support:
  - `injectActionAnnotationRoot()`: Injects overlay DOM
  - `updateActionAnnotation(event)`: Updates overlay text
  - `removeActionAnnotations()`: Cleans up overlay
- [x] Global recorder instance via `getGlobalScreencastRecorder()`
- [x] Global recorder reset via `resetGlobalScreencastRecorder()`

### 4. Browser Actions Integration (src/browser/actions.ts)
- [x] Added `screencastStart(options)` method:
  - Policy routing with "browser_screencast_start"
  - Validates ScreencastOptions
  - Calls recorder.start() with page context
  - Returns ActionResult with session
- [x] Added `screencastStop()` method:
  - Policy routing with "browser_screencast_stop"
  - Calls recorder.stop()
  - Returns ActionResult with session and receipt
- [x] Added `screencastStatus()` method:
  - Policy routing with "browser_screencast_status"
  - Calls recorder.status()
  - Returns ActionResult with session
- [x] Added `recordActionTimeline(event)` private method:
  - Appends events to recorder timeline
  - Best-effort infrastructure (no failure on recorder error)
- [x] Added `withTimeline(action, fn)` helper:
  - Wraps action execution with timeline recording
  - Records start/end timestamps
  - Captures success/error status

### 5. Debug Bundle Extension (src/observability/debug_bundle.ts)
- [x] Extended `BundleBuilderOptions` interface:
  - screencastPath?: string
  - receiptPath?: string
- [x] Updated `collectBrowserEvidence()` to include:
  - screencastPath from options
  - receiptPath from options
  - timelinePath from options
- [x] Updated `buildDebugBundle()` to pass screencast/receipt metadata

### 6. TypeScript API Extension (src/browser_control.ts)
- [x] Added `ScreencastNamespace` interface:
  - `start(options)`: Promise<ActionResult<{ session: ScreencastSession }>>
  - `stop()`: Promise<ActionResult<{ session, receiptId?, timelinePath? }>>
  - `status()`: Promise<ActionResult<{ session: ScreencastSession | null }>>
- [x] Extended `BrowserNamespace` with `screencast: ScreencastNamespace`
- [x] Implemented `screencastNamespace` object
- [x] Added `receipt(receiptId)` method to `DebugNamespace`:
  - Returns DebugReceipt | null
  - Uses recorder.loadReceipt()

### 7. MCP Tools Extension (src/mcp/tools/browser.ts)
- [x] Added `bc_browser_screencast_start` tool:
  - Input: path, showActions, annotationPosition, retention, sessionId
  - Handler: Calls api.browser.screencast.start()
- [x] Added `bc_browser_screencast_stop` tool:
  - Input: sessionId
  - Handler: Calls api.browser.screencast.stop()
- [x] Added `bc_browser_screencast_status` tool:
  - Input: sessionId
  - Handler: Calls api.browser.screencast.status()

### 8. CLI Extension (src/cli.ts)
- [x] Added screencast flags to VALUE_FLAGS:
  - path, show-actions, annotation-position, retention
- [x] Added screencast command cases in handleBrowserAction:
  - `screencast start [--path] [--show-actions] [--annotation-position] [--retention]`
  - `screencast stop`
  - `screencast status`
- [x] Added debug receipt command in handleDebug:
  - `debug receipt <id>`
  - Policy check: debug_receipt_export
  - Uses recorder.loadReceipt()
- [x] Updated help text with new commands

### 9. Policy Profiles (src/policy/execution_router.ts)
- [x] Added screencast action risk rules:
  - `browser_screencast_start`, `browser_screencast_stop`: moderate risk, low_level path
  - `browser_screencast_status`: low risk, command path
- [x] Added debug receipt risk rule:
  - `debug_receipt_export`: low risk, command path

### 10. Unit Tests (tests/unit/observability/screencast.test.ts)
- [x] Created screencast.test.ts with tests for:
  - Start screencast session
  - Stop screencast and generate receipt
  - Return status for active session
  - Return null when no active session
  - Append events to timeline
  - Save timeline and receipt on stop
  - Apply retention policy
  - Load receipt by ID
  - Throw when starting if already recording
  - Global recorder singleton
  - Global recorder reset

## Verification Steps

1. **Type Check**: Run `npm run typecheck` to verify no type errors
2. **Unit Tests**: Run `npm run test:ci` to verify all tests pass
3. **CLI Manual Verification**:
   - Test `bc browser screencast start --show-actions`
   - Test `bc browser screencast status`
   - Test `bc browser screencast stop`
   - Test `bc debug receipt <id>`
4. **MCP Tool Verification**:
   - Test bc_browser_screencast_start
   - Test bc_browser_screencast_stop
   - Test bc_browser_screencast_status
5. **TypeScript API Verification**:
   - Test browser.screencast.start()
   - Test browser.screencast.stop()
   - Test browser.screencast.status()
   - Test debug.receipt()

## Key Design Decisions

1. **Opt-in Recording**: Screencast is opt-in, not automatic
2. **Retention Policies**: Three modes (keep, delete-on-success, debug-only)
3. **Recording Modes**: Native (Playwright) → Frames → Metadata-only fallback chain
4. **Path Safety**: All artifact paths validated to be within data home
5. **Action Timeline**: Best-effort recording, no failure propagation
6. **Policy Routing**: Screencast actions routed through policy engine with appropriate risk levels
7. **Session Isolation**: Screencast state tracked per browser session

## Integration Points

- **Browser Actions**: Screencast methods integrated into BrowserActions class
- **Debug Bundle**: Screencast/receipt metadata included in debug bundles
- **Session Manager**: Screencast recorder uses session IDs for isolation
- **Policy Engine**: Screencast actions assigned moderate/low risk levels
- **Memory Store**: Session state persisted in MemoryStore

## Files Modified

- src/observability/types.ts
- src/shared/paths.ts
- src/observability/screencast.ts (new file)
- src/browser/actions.ts
- src/observability/debug_bundle.ts
- src/browser_control.ts
- src/mcp/tools/browser.ts
- src/cli.ts
- src/policy/execution_router.ts
- tests/unit/observability/screencast.test.ts (new file)

## Next Steps

1. Run verification commands
2. Fix any issues found during verification
3. Update documentation if needed
4. Mark Section 26 as complete
