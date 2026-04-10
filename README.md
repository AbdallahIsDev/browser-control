# Browser Automation Core
## Global Reusable Framework — Codex + Playwright + CDP

This folder is the **global** browser automation foundation.
Never duplicate the core files — import them.

---

## Folder Structure

```
browser-automation-core/
│
├── launch_browser.ps1       ← Generic Chrome launcher (shared automation profile)
├── launch_browser.bat       ← Wrapper bat — starts Chrome on the shared automation profile
├── .interop/                ← Runtime metadata shared between Windows Chrome and WSL clients
├── browser_core.ts          ← Global: connect, smartClick, smartFill, screenshots
├── selector_store.ts        ← Global: the selector caching pattern (reference)
│
└── project-template/        ← COPY THIS for every new project
    ├── _README.ts
    ├── setup.json           ← Project config: port and target site info
    ├── selectors.ts         ← Site-specific discovery + SelectorMap
    ├── selectors.json       ← Auto-generated cache (commit this file)
    └── main.ts              ← Your automation script
```

---

## Quick Start — New Project

```bash
# 1. Copy the template
cp -r project-template/ my-new-project/
cd my-new-project/

# 2. Edit setup.json with your target URL and port
#    Edit selectors.ts with your site's elements

# 3. Start the browser debug session on the shared automation profile
launch_browser.bat 9222

# 4. Run selector discovery (one-time, saves selectors.json)
npx ts-node selectors.ts

# 5. Write your automation in main.ts, then run it
npx ts-node main.ts
```

---

## Windows + WSL Interop

`launch_browser.bat` now defaults to `0.0.0.0` for the Chrome debug bind address so the same
Windows Chrome session can be attached from Windows and WSL.

Each launch writes `.interop/chrome-debug.json` with the preferred CDP endpoint candidates.
`browser_core.ts` and `stagehand_core.ts` read that metadata automatically, so Hermes in WSL does
not need a manual port proxy or a hardcoded host IP anymore.

If you ever need to override discovery manually:

- `BROWSER_DEBUG_URL=http://host:port`
- `BROWSER_DEBUG_HOST=host`

You can still override the bind address explicitly:

```bat
launch_browser.bat 9222 0.0.0.0
```

The launcher validates local CDP access and, when WSL is installed, it also probes the endpoint
from WSL before reporting success.

---

## Speed Principles

| What | Why it's fast |
|---|---|
| `smartClick(page, sel)` | Uses Playwright actionability checks with a compact retry path |
| `smartFill(page, sel, val)` | Uses locator focus/fill and only commits with `commit: true` |
| `loadSelectors()` | Reads from JSON on first use — no network, no DOM |
| `discoverSelectors()` | Runs ONCE, then skips forever (`selectorsDiscovered: true`) |
| `screenshotElement()` | Crops to element only — not `fullPage:true` |
| `waitForElement()` | Condition-based — never fixed `waitForTimeout()` |
| `waitForAny()` | `Promise.any()` across multiple selectors — only succeeds on the first visible match |
| URL-based tab detection | `page.url().includes(pattern)` — instant, never fails |

---

## The Selector Priority Order

Inside `page.evaluate()`, every element is converted to a selector using this priority:

```
data-test     → [data-test="value"]         ← most stable (test attributes rarely change)
data-testid   → [data-testid="value"]        ← stable
aria-label    → [aria-label="value"]         ← stable for accessibility-first sites
id            → #id                          ← stable if ID is semantic
className     → tag.class1.class2            ← fragile — React rebuilds these often
```

React apps like Exness use `data-test` attributes heavily — these are the best selectors
because they are explicitly added for testing and do not change when the UI is rebuilt.

---

## Adding a New Project — Checklist

- [ ] Copy `project-template/` to `my-project/`
- [ ] Edit `setup.json`: set `target_url`, `url_pattern`, `project`
- [ ] Edit `selectors.ts`: update `SelectorMap` interface and discovery logic
- [ ] Run `launch_browser.bat` to start the shared automation profile on the debug port
- [ ] Open the target site in the debug Chrome window
- [ ] Run `npx ts-node selectors.ts` to populate `selectors.json`
- [ ] Verify `selectors.json` has `"selectorsDiscovered": true`
- [ ] Write automation in `main.ts` using `browser_core.ts` + `selectors`
- [ ] Test with `npx ts-node main.ts`

---

## Windows + WSL

`launch_browser.bat` now does two things on Windows:

- launches the shared Chrome automation profile on the CDP port
- publishes that same CDP session to WSL through a local bridge on the WSL gateway IP

That means the same visible Windows Chrome session is reachable from both environments:

- Windows tools use `http://127.0.0.1:<port>`
- WSL tools prefer the bridge URL written to `.interop/chrome-debug.json`

If the launcher finds an existing Chrome debug session that is only bound to loopback, it repairs WSL access by starting the bridge instead of opening a second browser.

## Global Installation Path

```
C:\Users\11\browser-automation-core\
```

All automation projects should share the same persistent automation profile so
logins persist between runs. `launch_browser.bat` enables the debug port on the
shared profile and writes connection metadata to `.interop/chrome-debug.json`;
it does not create a different profile for each project.

Chrome 136+ no longer allows `--remote-debugging-port` on the default Chrome
data directory, so the launcher intentionally uses one dedicated shared profile
for automation instead of your everyday Chrome profile.

Import `browser_core.ts` using a relative path from your project:
```typescript
import { connectBrowser, smartClick } from "../../browser-automation-core/browser_core";
```

Or add a `tsconfig.json` path alias:
```json
{
  "compilerOptions": {
    "paths": {
      "@bac/*": ["C:/Users/11/browser-automation-core/*"]
    }
  }
}
```

Then import as:
```typescript
import { connectBrowser, smartClick } from "@bac/browser_core";
```

Load environment variables before connecting Stagehand:
```typescript
import "dotenv/config";
```

Required Stagehand env vars:
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (optional override)
- `OPENROUTER_BASE_URL` (optional override)
