# Review Checklist

## Code Review Checklist

- [ ] New code uses existing Browser Control runtime modules.
- [ ] No duplicate automation engine.
- [ ] No CLI shell-out where direct API exists.
- [ ] Public API/CLI/MCP compatibility preserved.
- [ ] ActionResult contracts preserved.
- [ ] Route schemas typed and validated.
- [ ] Errors redacted and useful.
- [ ] Tests cover behavior, not snapshots only.

## Security Review Checklist

- [ ] Server binds `127.0.0.1` by default.
- [ ] Non-loopback bind requires explicit flag and warning.
- [ ] HTTP routes require token for browser-origin use.
- [ ] WebSocket/SSE endpoints require token.
- [ ] CORS allowlist is restrictive.
- [ ] CSRF risk addressed if cookies are used.
- [ ] Every terminal route goes through policy.
- [ ] Every filesystem route goes through policy.
- [ ] Every browser action route goes through policy.
- [ ] Config mutation goes through policy.
- [ ] Debug bundle/export routes go through policy.
- [ ] Secrets redacted in config/log/debug/error responses.
- [ ] Desktop renderer has no raw Node APIs.
- [ ] Electron navigation locked down.

## Accessibility Checklist

- [ ] Keyboard navigation works.
- [ ] Icon buttons have labels/tooltips.
- [ ] Tables have headers.
- [ ] Dialogs trap focus.
- [ ] Terminal output readable and selectable.
- [ ] Error states announced or visible.
- [ ] Color not only status indicator.

## UI Quality Checklist

- [ ] First screen is operator dashboard, not landing page.
- [ ] Dense practical layout.
- [ ] No fake/mock success actions.
- [ ] Loading/empty/error states exist.
- [ ] Text does not overlap at desktop/mobile widths.
- [ ] Terminal dimensions stable.
- [ ] No nested card clutter.
- [ ] Palette not one-note.

## Cross-Platform Checklist

- [ ] Windows paths handled.
- [ ] PowerShell default terminal works.
- [ ] Linux/macOS shell paths not broken.
- [ ] Browser absence degrades browser features only.
- [ ] Desktop build gated to Windows where needed.

## Packaging Checklist

- [ ] Existing `npm run build` works.
- [ ] Existing package exports unchanged.
- [ ] New scripts documented.
- [ ] Frontend build artifacts served intentionally.
- [ ] Desktop package excludes secrets/runtime temp files.

## Test Verification Checklist

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run cli -- --help`
- [ ] `npm run cli -- status`
- [ ] `npm run web:build`
- [ ] `npm run desktop:build`

## Review Notes

Implementation review performed for first backend slice.

Code review notes:

- Local app server uses `createBrowserControl()` rather than a parallel automation engine.
- CLI help exposes `web serve`, `web open`, and dashboard open backed by app server.
- Public exports added through `src/index.ts`.
- Task/scheduler/log bridges and full UI/desktop shell remain incomplete.

Security review notes:

- Server binds loopback by default and rejects non-loopback unless `allowRemote` is explicit.
- HTTP API requires bearer or `X-API-Key` token.
- Query token is accepted only for WebSocket upgrade, not HTTP API routes.
- Browser URL printed by CLI no longer includes token.
- CORS only reflects configured allowed origins.
- Event payloads and JSON responses pass through redaction.

Verification notes:

- `npm run typecheck`: pass.
- `npm run build`: pass.
- `tests/unit/web_app_server.test.ts`: pass, 2 tests.
- `npm run cli -- --help`: pass.
- `npm run cli -- status --json`: pass; daemon stopped, broker unreachable in current local state.
- `npm test`: timed out after 244 seconds before final result.
- `npm run test:ci`: timed out after 244 seconds before final result.
