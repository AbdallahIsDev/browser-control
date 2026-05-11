# Browser Control Premium Completion Tracker

Updated: 2026-05-12.

Scope: third-pass remaining blockers from `INSTRUCTIONS.md`, plus one newly verified observability warning.

## Verification Status

| Gate | Status | Evidence |
| --- | --- | --- |
| Biome | Pass | `npx biome check . --max-diagnostics=30` — checked 42 files, no errors. |
| Typecheck | Pass | `npm run typecheck` exited 0. |
| Web typecheck | Pass | `npm run web:typecheck` exited 0. |
| Web build | Pass | `npm run web:build` exited 0; Vite built 29 modules. |
| MCP tool count | Pass | `npx ts-node scratch/count_tools.ts` — `Total tools: 66`; no malformed DB warning. |
| State tests | Pass | `npm run test:state` — 25/25 pass. |
| MCP tests | Pass | `npm run test:mcp` — 22/22 pass. |
| Web tests | Pass | `npm run test:web` — 19/19 pass. |
| Desktop tests | Pass | `npm run test:desktop` — 2/2 pass. |
| CI tests | Pass | `npm run test:ci` — 347/347 pass. |
| Build | Pass | `npm run build` exited 0. |
| Package smoke | Pass | `npm run test:package` — package smoke passed, 426 files checked. |
| Pack dry run | Pass | `npm pack --dry-run --json` — `entryCount: 426`, no errors. |
| Desktop build | Pass | `npm run desktop:build` exited 0; `dist-desktop-2/win-unpacked` produced. |

## Current Blocker Status

1. Biome errors in `web/src/App.tsx` — resolved. Backdrop is a semantic button, nav SVGs are decorative with `aria-hidden` and `focusable=false`.
2. Mobile horizontal overflow — resolved. Fresh helper run reports `scrollWidth=375, innerWidth=375`; mobile screenshot is usable.
3. Screenshot helper — restored and hardened. `scripts/capture_ui_screenshots.cjs` captures desktop, mobile, after-refresh, verifies nonempty files, closes browser in `finally`, exits nonzero on failure, and writes `reports/ui-verification/screenshot-manifest.json`.
4. `web:serve` malformed DB warning — resolved in latest real default run. First retry hit `EADDRINUSE` because stale PID 3976 was already listening on 7790; that process was `ts-node src/web/server.ts` and was stopped. Clean rerun printed only the expected Node SQLite experimental warning, no malformed DB warning.
5. Desktop UI screenshot — resolved. `scripts/capture_desktop_offscreen.cjs` produced `reports/ui-verification/desktop-sidebar.png`; window title was `Browser Control Premium`; image is nonblank.
6. Desktop process cleanup — resolved. Final `Get-Process "Browser Control"` check found no running Browser Control desktop processes. Port 7790 also clear after web verification.
7. Tracker accuracy — corrected in this file.
8. New observability warning — resolved. `src/browser/actions.ts` no longer calls `page.waitForTimeout`; it uses a runtime-neutral timer before persisting observability.

## Screenshot Artifacts

All paths are under `reports/ui-verification/`.

| Artifact | Status | Evidence |
| --- | --- | --- |
| `sidebar-desktop.png` | Present | 78,788 bytes, fresh capture at 2026-05-12 01:06 local. |
| `sidebar-mobile.png` | Present | 37,994 bytes, fresh 375x812 capture; no horizontal overflow. |
| `sidebar-after-hard-refresh.png` | Present | 78,788 bytes, fresh capture after `page.reload()`. Pixels match desktop screenshot because the UI is deterministic; `screenshot-manifest.json` records it as a separate post-reload capture. |
| `desktop-sidebar.png` | Present | 76,769 bytes; nonblank desktop UI screenshot. |
| `screenshot-manifest.json` | Present | Records URL, separate capture timestamps, titles, paths, and byte sizes. |

## Known Non-Blocking Findings

- `npm run test:browser-features` is not an `INSTRUCTIONS.md` final gate and currently fails in live managed-Chrome tests on Windows with profile lock errors such as `Default\\Network` being used by another process. Required gates still pass.
- `npm run desktop:build` reports packaging warnings: missing package author, asar disabled, duplicate dependency references, and Node `[DEP0190]` from electron-builder. Build exits 0.
- `test:ci` prints Node `ExperimentalWarning: SQLite is an experimental feature`; this is expected and not the malformed DB warning.

## Feature Backlog Status

Per `INSTRUCTIONS.md`, these are after-blockers backlog items and were not implemented in this pass.

| Feature | Status |
| --- | --- |
| Credential Vault | Not started |
| Browser Terminal UI, DOM-native | Partial: PTY engine exists |
| Workflow Graph v2 | Partial: linear v1 exists |
| Package Marketplace | Not started |
| Local Model Provider Router | Not started |
| Record/Replay Builder | Not started |
| Visual Diff/Debug | Partial: screenshots/debug artifacts exist |
| Portless `.localhost` Proxy | Not started |
| Browserbase Provider | Not started |
