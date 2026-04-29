# Browser Control Project Instructions

This repo is the Browser Control project. For any task where user asks Codex to open Chrome/browser, control a website, scrape data, test a web page, operate a web app, fill forms, click through UI, take screenshots, run browser + terminal + filesystem automation, or do local browser automation, prefer Browser Control MCP tools first.

If the `browser-control` skill is available, use it automatically for browser/Chrome/web automation tasks, even when user does not explicitly type `$browser-control`.

Default execution order:

1. Call `bc_status`.
2. Use Browser Control a11y path first:
   - `bc_browser_open`
   - `bc_browser_snapshot`
   - refs like `@e3`
   - `bc_browser_click`
   - `bc_browser_fill`
   - `bc_browser_press`
   - `bc_browser_screenshot`
3. Use debug/network/DOM fallback only when a11y state is insufficient.
4. Use terminal/filesystem MCP for support work:
   - `bc_terminal_exec`
   - `bc_fs_*`
5. Respect Browser Control policy decisions and confirmations.
6. Before creating automation helper scripts, read `C:\Users\11\.browser-control\automation-helpers\registry.json` if it exists and reuse matching helpers by site/domain/task/failure type.
7. If no helper fits and a new helper is created, register it in `C:\Users\11\.browser-control\automation-helpers\registry.json` with site, task tags, file paths, usage, and purpose.

Do not use Playwright, generic web browsing, shell browser scripts, or raw CDP before Browser Control MCP unless Browser Control MCP cannot complete the task or user explicitly requests another tool.

For self-healing browser automation:

- Refresh snapshot and retry stale refs first.
- Inspect DOM/debug/network when page structure blocks a11y.
- Search the helper registry before writing helper code.
- Reuse existing helper scripts when they fit the current site/task/failure.
- Create temporary helpers under `C:\Users\11\.browser-control\automation-helpers\`, not inside this repo/project, unless user explicitly asks to edit project code.
- Do not create workflow helper scripts, screenshots, recordings, runtime files, or scratch files inside `C:\Users\11\browser-control` during browser automation.
- Do not patch Browser Control core mid-task to fix one target website.
- Verify each browser action with URL, title, snapshot, visible state, or screenshot.

For browser games or complex apps:

- Maintain task/game state after each observed change.
- Read DOM/a11y first; use screenshots/canvas only when DOM lacks state.
- Map coordinates only after verifying viewport and element bounds.
- Do not use hidden engines/APIs unless user explicitly permits them.

Cleanup:

- Close only tabs/sessions/helpers created for the task when safe.
- Stop daemon only if user asked for cleanup or this session started it for a one-off test.
- Delete temp files created by the task unless user wants artifacts.
- Report screenshots/debug/file paths when useful.
