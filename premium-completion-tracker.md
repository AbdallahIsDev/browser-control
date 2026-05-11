# Browser Control Premium Completion Tracker

Updated: 2026-05-11.

Scope: third-pass remaining blockers from `INSTRUCTIONS.md`.

## Verification Status

| Gate | Status | Evidence |
| --- | --- | --- |
| Biome | ✅ Pass | `npx biome check . --max-diagnostics=30` exited 0; `Checked 42 files`; no errors. Verified 2026-05-11. |
| Typecheck | ✅ Pass | `npm run typecheck` exited 0. |
| Web typecheck | ⚠️ Unverified | Not run in current audit. |
| Web build | ⚠️ Unverified | Not run in current audit. |
| MCP tool count | ⚠️ Unverified | `scratch/count_tools.ts` exists; 66 tools previously reported. |
| State tests | ⚠️ Unverified | Not run in current audit. |
| MCP tests | ⚠️ Unverified | Not run in current audit. |
| Web tests | ⚠️ Unverified | Not run in current audit. |
| Desktop tests | ⚠️ Unverified | Not run in current audit. |
| CI tests | ⚠️ Unverified | Not run in current audit. |
| Build | ⚠️ Unverified | Not run in current audit. |
| Package smoke | ⚠️ Unverified | Not run in current audit. |
| Pack dry run | ⚠️ Unverified | Not run in current audit. |
| Desktop build | ⚠️ Unverified | Not run in current audit. |

## Fixed Blockers (previously verified)

1. **Biome errors** in `web/src/App.tsx` — backdrop is a `<button type="button">`, hamburger SVG has `aria-hidden="true" focusable="false"`.
2. **Mobile horizontal overflow** — `App.css` has `min-width: 0`, `max-width: 100%`, single-column grid on mobile, hidden header metrics.
3. **Screenshot helper** — `scripts/capture_ui_screenshots.cjs` and `scripts/capture_desktop_offscreen.cjs` exist.
4. **Malformed DB recovery** — `sqlite_util.ts` has quarantine logic; `sqlite_recovery.test.ts` wired to CI.
5. **Desktop process cleanup** — `desktop/main.cjs` has `killServerProcessTree()` on quit hooks.
6. **Settings destructive guard** — `SettingsView.tsx` requires explicit confirmation string.

## Known Limitations (not blockers)

- No shadcn/ui or component library — all UI is custom CSS
- No loading states, error boundaries, or toast notifications in dashboard
- Trading supervisor has no live broker adapter integration
- No visual regression tests or accessibility tests in CI
- Benchmark suite is minimal (4 default tasks)
- Automation packages are local-only; no remote registry

## Feature Backlog Status

Per `INSTRUCTIONS.md` after-blockers backlog:

| Feature | Status |
|---------|--------|
| Credential Vault | Not started |
| Browser Terminal UI (DOM-native) | Partial — PTY engine only |
| Workflow Graph v2 (branching/loops) | Partial — linear v1 only |
| Package Marketplace | Not started |
| Local Model Provider Router | Not started |
| Record/Replay Builder | Not started |
| Visual Diff/Debug | Partial — screenshots only |
| Portless `.localhost` Proxy | Not started |
| Browserbase Provider | Not started |
