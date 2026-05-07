# Implementation Plan

## Current Progress

- Required repository docs read.
- Required implementation files inspected.
- Existing dashboard/server state discovered:
  - `src/operator/dashboard.ts` is a read-only status stub with empty events.
  - `src/runtime/broker_server.ts` already exposes status/config/tasks/scheduler/term/fs plus `/ws` task-completion events.
  - No full web UI or Windows desktop wrapper exists.
- Documentation/spec phase created in this folder.
- First backend slice implemented:
  - `src/web/server.ts`
  - `src/web/security.ts`
  - `src/web/events.ts`
  - `src/web/types.ts`
  - CLI `web serve`, `web open`, and dashboard open path.
  - Focused tests in `tests/unit/web_app_server.test.ts`.

## Chosen Architecture

Use one shared UI codebase and one local app server bridge:

- Backend: `src/web/`
- Frontend: `web/`
- Desktop: `desktop/` using Electron

Why:

- existing stack is Node/TypeScript
- terminal runtime uses `node-pty`
- Electron can manage local Node child processes cleanly on Windows
- shared web UI avoids duplicated desktop/web product logic
- app server can reuse existing `createBrowserControl()` facade and broker security patterns

## Folders to Create

- `src/web/`
- `web/`
- `desktop/`
- `tests/unit/web/`
- `tests/unit/desktop/`

## File/Module Ownership

- `src/web/types.ts`: API/event schemas
- `src/web/security.ts`: auth, origin, CORS, bind validation, token generation
- `src/web/events.ts`: event hub, redaction, replay buffer
- `src/web/server.ts`: HTTP/static server lifecycle
- `src/web/routes.ts`: route dispatch
- `src/web/terminal_bridge.ts`: terminal routes/events
- `src/web/browser_bridge.ts`: browser routes/events
- `src/web/task_bridge.ts`: task/scheduler routes/events
- `src/web/log_bridge.ts`: logs/debug/audit routes
- `web/src/api/*`: typed client and event client
- `web/src/components/*`: dashboard panels
- `web/src/App.tsx`: navigation and page shell
- `desktop/main.ts`: Electron process and app-server ownership
- `desktop/preload.ts`: minimal safe preload
- `desktop/security.ts`: navigation/window policy

## Order of Implementation

1. Add `src/web/types.ts`, `security.ts`, `events.ts`.
2. Add `src/web/server.ts` with `/api/status`, `/api/capabilities`, `/events`.
3. Add route bridge for config/policy/status/health.
4. Add terminal bridge and tests.
5. Add browser/fs/task/scheduler/debug routes.
6. Add CLI commands for web server/open.
7. Add web UI skeleton with real API client.
8. Add dashboard pages incrementally.
9. Add desktop Electron shell.
10. Add package scripts and build integration.
11. Add tests and verification.
12. Run code review and security review.

## Test Plan Per Step

- Security: token required, browser-origin denied without token, CORS limited, non-loopback guard.
- Routes: status/config/capabilities return typed JSON.
- Terminal: create/list/exec/read/snapshot/close route through policy and return `ActionResult`.
- FS: read/list/write/delete policy cases.
- Tasks/scheduler: create/list/pause/resume/delete.
- Events: unauthorized rejected; authorized client gets typed events.
- UI: build/typecheck; render empty/error/loading states with mocked local API.
- Desktop: main process uses secure `BrowserWindow` options and blocks external navigation.

## Rollback/Resume Instructions

- If backend routes fail, leave docs and remove only `src/web/*` files added in that step.
- If frontend build breaks package build, keep `web/` separate from root build until integrated.
- If Electron dependency causes install/build issues, keep desktop folder documented and gated behind separate scripts.
- Keep compatibility wrappers untouched unless needed for public exports.

## Risks

- Scope is large; backend bridge should land before full UI.
- Broker and app server contracts may overlap; avoid duplicating logic where broker is sufficient.
- Terminal streaming may need polling first if daemon lacks event callbacks.
- Desktop packaging can add heavy dependency churn.
- Security footgun if token/CORS is partial.

## Checklist

- [x] Read required docs and implementation files.
- [x] Create `docs/web-desktop-wrapper/` documentation.
- [x] Add `src/web` typed contracts.
- [x] Add local app server and security layer.
- [x] Add event stream.
- [x] Add terminal bridge.
- [x] Add initial browser bridge.
- [x] Add initial filesystem bridge.
- [x] Add task/scheduler bridge.
- [x] Add logs/audit/debug evidence bridge.
- [x] Add web frontend.
- [x] Add desktop shell.
- [x] Add full tests.
- [x] Run code review.
- [x] Run security review.
- [x] Run verification commands.
