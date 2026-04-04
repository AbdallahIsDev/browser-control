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
├── browser_core.ts          ← Global: connect, fastClick, fastFill, screenshots
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

## Speed Principles

| What | Why it's fast |
|---|---|
| `fastClick(page, sel)` | Uses `el.click()` in `page.evaluate()` — zero Playwright overhead |
| `fastFill(page, sel, val)` | `focus → Ctrl+A → type delay:0` — no React re-render triggers |
| `loadSelectors()` | Reads from JSON at import time — no network, no DOM |
| `discoverSelectors()` | Runs ONCE, then skips forever (`selectorsDiscovered: true`) |
| `screenshotElement()` | Crops to element only — not `fullPage:true` |
| `waitForElement()` | Condition-based — never fixed `waitForTimeout()` |
| `waitForAny()` | `Promise.race()` across multiple selectors — whichever appears first |
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

## Existing Projects Using This Framework

| Project | Folder | Target Site | Selectors File |
|---|---|---|---|
| ICT Trading | `C:\Users\11\Downloads\Cron\ICT Trading\scripts\` | my.exness.com/webtrading | mt5_selectors.json |

---

## Global Installation Path

```
C:\Users\11\browser-automation-core\
```

All automation projects should share the same persistent automation profile so
logins persist between runs. `launch_browser.bat` only enables the debug port;
it does not open a URL or create a different profile for each project.

Chrome 136+ no longer allows `--remote-debugging-port` on the default Chrome
data directory, so the launcher intentionally uses one dedicated shared profile
for automation instead of your everyday Chrome profile.

Import `browser_core.ts` using a relative path from your project:
```typescript
import { connectBrowser, fastClick } from "../../browser-automation-core/browser_core";
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
import { connectBrowser, fastClick } from "@bac/browser_core";
```
