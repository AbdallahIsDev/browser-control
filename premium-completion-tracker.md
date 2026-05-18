# Browser Control Premium Completion Tracker

Updated: 2026-05-18 Africa/Cairo.

Overall status: **Partial**. Current locked-dashboard and app-shell UI chunk is implemented and verified. The broader `INSTRUCTIONS.md` Missing Premium Features backlog remains incomplete.

---

## Locked Dashboard + Floating Sidebar Shell — Verified UI Chunk (2026-05-18)

### Status

Partial relative to `INSTRUCTIONS.md`; complete for this UI chunk.

### Implemented

- Simplified locked dashboard into `LockedDashboardScreen`, `AuthHelpPanel`, `CommandCopyCard`, and `CommandInlineCopy`.
- Replaced whole-card copy behavior with explicit command-row copy buttons.
- Removed misleading “Click anywhere to copy” copy.
- Added exact accessible copy labels: `Copy command: <command>`.
- Added copied feedback and verified clipboard writes `bc web open`.
- Changed locked layout to desktop two-column intro/help and three command cards per row when width allows.
- Added floating rounded sidebar panel with window margin.
- Added desktop sidebar collapse/expand state persisted in `localStorage` via `bc-sidebar-collapsed`.
- Kept collapsed desktop sidebar as icon rail with logo icon, nav icons, accessible names, and tooltip titles.
- Moved sidebar toggle into the sidebar header; this keeps the control near the thing it controls, avoids page-title clutter, and remains reachable when collapsed.
- Removed duplicate sidebar bottom theme toggle; top-bar theme toggle remains available.
- Removed hard sidebar vertical border and toolbar bottom border.
- Connected provider/policy top-bar badges to live status fields or honest unknown/unavailable fallbacks.
- Replaced ambiguous `Forget` copy with `Clear token` and accessible label `Clear stored sign-in token`.

### Verification

| Gate | Result |
|------|--------|
| `npx biome check . --max-diagnostics=30` | Pass |
| `npm run react:doctor` | Pass, 0 errors; existing size-only warnings remain |
| `npm run typecheck` | Pass |
| `npm run web:typecheck` | Pass |
| `npm run web:build` | Pass; existing >500 kB chunk warning remains |
| `npm run test:web` | Pass, 67/67 |
| `npm run test:desktop` | Pass, 3/3 |
| Browser Control a11y verification | Pass for locked/authenticated shell and collapsed sidebar |
| Playwright mobile fallback | Pass; 375x812 no horizontal overflow |
| Copy command verification | Pass; clipboard contains `bc web open` |
| Desktop offscreen Electron screenshot | Pass; `desktop-shell.png` nonempty |
| Process cleanup | Desktop process cleaned; repo-local random-port web server stopped; only pre-existing global port 7790 server remains |

### Fresh screenshots/artifacts

| Path | Purpose |
|------|---------|
| `reports/ui-verification/locked-dashboard-desktop-dark.png` | Locked dashboard desktop dark |
| `reports/ui-verification/locked-dashboard-desktop-light.png` | Locked dashboard desktop light |
| `reports/ui-verification/locked-dashboard-mobile.png` | Locked dashboard mobile 375x812 |
| `reports/ui-verification/sidebar-expanded-desktop.png` | Authenticated expanded sidebar |
| `reports/ui-verification/sidebar-collapsed-desktop.png` | Authenticated collapsed icon rail |
| `reports/ui-verification/topbar-authenticated-desktop.png` | Authenticated top bar badges |
| `reports/ui-verification/mobile-shell.png` | Authenticated mobile shell |
| `reports/ui-verification/command-desktop.png` | Command/Home desktop |
| `reports/ui-verification/command-mobile.png` | Command/Home mobile |
| `reports/ui-verification/desktop-shell.png` | Electron desktop shell |
| `reports/ui-verification/screenshot-manifest.json` | Current screenshot manifest from `capture_ui_screenshots.cjs` |

### UX blacklist review

Reviewed: Home, Tasks, Browser, Workflows, Skills, Evidence, Settings, Terminal, Packages, Automations, Advanced, locked dashboard.

Findings fixed in this chunk:

- Locked dashboard copy affordance was ambiguous; fixed with command-row copy buttons.
- Sidebar felt pinned and bordered; fixed with floating rounded panel.
- Duplicate theme toggle existed in sidebar bottom and top bar; sidebar copy removed.
- Icon-only collapsed nav needed accessible labels; added `aria-label`, `title`, and tooltip content.
- Top bar badge fallbacks could imply known provider/policy state; now use unknown/unavailable fallbacks when state is missing.

Remaining non-blocking product debt:

- Evidence and Settings still expose advanced/debug-heavy content by design; not rewritten in this UI chunk.
- `INSTRUCTIONS.md` P0/P1/P2 premium missing features remain incomplete and must be implemented separately.

### Branding

- Active nav remains blue primary.
- No orange primary UI was introduced in this chunk.
- Existing favicon SVG uses `prefers-color-scheme`; no favicon implementation change was needed.
- Electron icon test passed and desktop screenshot is nonblank.

### Remaining blockers

- P0 native JS dialog detection/action/tool is not implemented.
- P0 raw CDP passthrough tool is not implemented.
- P1/P2 premium backlog items listed in `INSTRUCTIONS.md` are not complete.
- Final full release gates (`test:ci`, `build`, `test:package`, `npm pack --dry-run --json`, `desktop:build`) still need to be rerun after all required backlog work, not just this UI chunk.

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
