# Browser Control Project Instructions

This repo is the Browser Control project. For Codex, Hermes-like, OpenCode-like, Gemini CLI, Claude Code, and any agent with terminal execution, prefer the Browser Control CLI first. MCP remains supported, but CLI-first execution is the default in this repo because it reduces tool calls, requests, latency, and token use while keeping structured `ActionResult` output.

If the `browser-control` skill is available, use it automatically for browser/Chrome/web automation tasks, even when user does not explicitly type `$browser-control`.

Default execution order:

1. Use CLI first for repo work, verification, and browser automation:
   - `bc status --json`
   - `bc browser state --json`
   - `bc browser open <url> --json`
   - `bc browser snapshot --json`
   - `bc browser act <action> ... --json`
   - `bc browser act fill <target> <text> --json`
   - `bc browser task run --steps-file <path> --json`
2. Prefer one high-level CLI command over many tiny actions:
   - Use `bc browser state` for compact page/tab/dialog/download status; use `bc browser snapshot` only when you specifically need the full accessibility tree.
   - Use `bc browser act --capture-on-success` when action + state can be one command.
   - Use `bc browser task run` for multi-step tasks.
   - Separate `bc browser ...` commands are separate CLI processes and re-initialize config, session, and broker/browser-control plumbing. Batch related work into `browser act` or `browser task run` when possible.
3. Use MCP Lite only when the agent environment cannot run CLI directly, or when direct in-client MCP browser interaction is required:
   - `bc_browser_state`
   - `bc_browser_act`
   - `bc_task_run`
4. Use full MCP only when the user explicitly asks for MCP/full tool mode or the task needs a tool not exposed in Lite/CLI.
5. Use debug/network/DOM fallback only when a11y state is insufficient.
6. Respect Browser Control policy decisions and confirmations.
7. When a11y snapshot cannot access page elements (canvas, shadow DOM, custom controls, iframes), first search `~/.browser-control/helpers/` for existing helpers matching the site/task. Reuse if found; create a new helper if none exists.
8. Before creating automation helper scripts, read `~/.browser-control/helpers/registry.json` to find any relevant existing helpers for the required task.
9. If a matching helper is listed in the registry but its files are missing, recreate/update the helper under its registered folder, then update the registry.
10. If you don't find any helpers that match the required task, create a new one for the required task. It should be registered in `~/.browser-control/helpers/registry.json` with site, task tags, file paths, usage, and purpose. On Windows, the same path may appear with backslashes.

Do not use Playwright, generic web browsing, shell browser scripts, raw CDP, or client built-in browser tools before Browser Control CLI/MCP unless Browser Control cannot complete the task or user explicitly requests another tool.

For self-healing browser automation:

- Refresh state/snapshot and retry stale refs first.
- Inspect DOM/debug/network when page structure blocks a11y.
- Search the helper registry before writing helper code.
- If a matching helper is listed in the registry but its files are missing, recreate/update the helper under its registered folder, then update the registry.
- Reuse existing helper scripts when they fit the current site/task/failure.
- Create temporary helpers under `~/.browser-control/helpers/`, not inside this repo/project, unless user explicitly asks to edit project code. On Windows, this is typically `~\.browser-control\helpers\`.
- Do not create workflow helper scripts, screenshots, recordings, runtime files, or scratch files inside `~\browser-control` during browser automation.
- Do not patch Browser Control core mid-task to fix one target website.
- Verify each browser action with URL, title, compact state, snapshot, visible state, or screenshot.

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
