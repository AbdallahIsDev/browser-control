# Browser Control Premium Completion Tracker

Updated: 2026-05-18 Africa/Cairo.

Overall status: **Partial**. All quality gates pass.

---

## Locked State CLI Command & Sidebar Fix — Complete (2026-05-18)

### What was broken

1. **Locked dashboard told users to run `browser-control web open`** — but `browser-control` is not a registered command on this machine. Only `bc` exists as a bin alias in `package.json` (`"bin": { "bc": "./cli.js" }`).
2. **Sidebar nav was disabled but still visible** — items showed `opacity-60` with tooltips, but all tabs were visible and felt like broken functionality. The user described it correctly: "dead navigation list as the primary UI."
3. **No source checkout fallback** — devs working from source had no documented way to open the web app.
4. **Verification script checked wrong CLI hint** — `verify-auth-flows.mjs` still asserted `browser-control web open`.

### What changed

**A. Locked copy fixed (App.tsx):**
- `browser-control web open` → `bc web open` in both toolbar hint and locked dashboard
- Added dev fallback: `npm run cli -- web open` for source checkout
- Clear distinction: "Installed package: bc web open" / "Source checkout: npm run cli -- web open"
- Tokenized URL hint uses dynamic `window.location.origin` (from prior session)

**B. Sidebar nav hidden when locked (AppSidebar.tsx):**
- Nav items wrapped in `{!locked && (...)}` — entirely hidden when no token
- Brand header and theme toggle footer remain visible
- No dead clickable tabs — clean brand-only locked sidebar

**C. Tests updated (web_frontend_format.test.ts):**
- `no-token state shows locked dashboard with CLI guidance` — now asserts `bc web open` and `npm run cli -- web open` instead of `browser-control web open`

**D. Verification script updated (verify-auth-flows.mjs):**
- `cliHint` check changed from `browser-control web open` → `bc web open`
- Added `sidebarNavHidden` check — confirms nav items are hidden when locked

### Correct commands

| Context | Command |
|---------|---------|
| Installed/global package | `bc web open` |
| Source checkout (dev) | `npm run cli -- web open` |

Do NOT use `browser-control web open` — it does not exist on this machine.

### Verification results

| Gate | Result |
|------|--------|
| `git status --short` | 37 modified, 4 untracked (all pre-existing or session scripts) |
| `npx biome check . --max-diagnostics=40` | ✅ 78 files, 0 errors |
| `npm run typecheck` | ✅ Exit 0 |
| `npm run web:typecheck` | ✅ Exit 0 |
| `npm run web:build` | ✅ Pass (503 kB chunk warning pre-existing) |
| `npm run test:web` | ✅ **65/65** |
| `npm run test:state` | ✅ **32/32** |
| `npm run docs:check` | ✅ 41 markdown, 77 MCP tools |
| API: no token → 401 | ✅ |
| API: valid token → 200 | ✅ |
| API: invalid token → 401 | ✅ |
| Playwright: 9 flows, 27 checks | ✅ **27/27 passes** |

### Screenshots captured

| Path | Content |
|------|---------|
| `reports/ui-verification/locked-no-token.png` | Locked: `bc web open` hint, lock icon, no nav items |
| `reports/ui-verification/locked-sidebar-state.png` | Locked sidebar: brand header + theme toggle only, no nav |
| `reports/ui-verification/auth-valid-token.png` | Signed in: Auth, Provider, Policy pills visible, sidebar active |
| `reports/ui-verification/auth-after-forget.png` | Forget → locked state returns |
| `reports/ui-verification/browser-valid-token.png` | Browser page content visible when signed in |
| `reports/ui-verification/skills-valid-token.png` | Skills page content loaded when signed in |
| `reports/ui-verification/listeners-after-cleanup.txt` | Only port 7790 (global package) remains |

### Cleanup

- Workspace server (port 59444, PID 36264) killed
- Only global installed package remains on port 7790 (PID 25980)
- All temp servers cleared

### Dirty file explanation

**Modified this session (2):**
- `web/src/App.tsx` — fixed command copy, `bc web open` + dev fallback
- `web/src/components/layout/AppSidebar.tsx` — hide nav when locked (`{!locked && ...}`)

**Modified pre-existing (35):** Theme migration, radius fixes, color system, component polish — all from prior sessions. See prior tracker entries for full list.

**Untracked (4):**
- `espocrm-business-report.md` — unrelated business document
- `scripts/capture_auth_screenshots.cjs` — auth screenshot utility (keep)
- `scripts/react_doctor.cjs` — React dashboard audit tool (keep)
- `scripts/verify-auth-flows.mjs` — Playwright end-to-end verification (keep, updated this session)

### Remaining Open Items

- P9 Browserbase: blocked until credentials available

### Known Non-Blocking Issues

- Biome sidebar.tsx `document.cookie` warning — generated shadcn code
- Electron Builder warnings — pre-existing
- `web_app_server.test.ts` node-pty issue — environment-specific
