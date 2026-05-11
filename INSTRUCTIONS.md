# Browser Control Premium: Third-Pass Remaining Blockers Only

This file is the source of truth for the next implementation session.

Do not restart the Browser Control Premium migration. Do not rebuild the React app, SQLite state layer, trading layer, desktop packaging, or MCP registry from scratch. Prior agents made real progress, but also overclaimed completion. Your job is to fix only the remaining verified blockers below, prove them with real evidence, and update the tracker truthfully.

==================================================
CURRENT VERIFIED STATE
==================================================

These items are already implemented enough. Do not redo them unless a remaining blocker forces a small targeted change.

1. React/Vite/TypeScript frontend exists.
   - `web/src/App.tsx`
   - `web/src/pages/`
   - old `web/src/app.js` is removed.

2. MCP tool count is under the 100-tool limit.
   - `npx ts-node scratch/count_tools.ts` currently prints:

```text
Total tools: 66
```

3. `scratch/count_tools.ts` no longer prints the malformed DB warning.
   - `ExperimentalWarning: SQLite is an experimental feature` may still appear. That is not the malformed DB warning.

4. SQLite recovery test is now wired into package scripts.
   - `tests/unit/sqlite_recovery.test.ts` is included in `test:state`.
   - `tests/unit/sqlite_recovery.test.ts` is included in `test:ci`.
   - Do not remove this wiring.

5. `npm run test:state` passed with 25 tests in review.

6. Settings cleanup destructive action has a confirmation guard in source.
   - `web/src/pages/SettingsView.tsx` disables destructive cleanup unless the exact confirmation string is entered.

7. The mobile sidebar changed to a hamburger/drawer pattern.
   - This is progress, but the mobile screenshot still shows horizontal overflow and clipped content.

==================================================
AFTER CURRENT BLOCKERS: MISSING FEATURE BACKLOG
==================================================

Do not start this backlog until the verified blockers in this file are fixed or the user explicitly asks for one backlog item.

This backlog exists so future AI coding agents do not reimplement features that already exist. Before implementing any item below:

1. Read the upstream source catalog first:
   - `C:\Users\11\browser-control\docs\production-upgrade\UPSTREAM-SOURCES.md`
   - This file explains which upstream repositories are useful, which features already exist in Browser Control, which parts are missing, and which repos must be study-only/avoid.
2. Read `docs/production-upgrade/STATUS.md`.
3. Search the codebase with `rg` for the feature name and related files.
4. Reuse existing code first.
5. Extend current architecture.
6. Do not create a parallel system.
7. Do not replace Browser Control core policy/session/runtime models.
8. Add tests and real product verification for every user-facing feature.

Current truth from code audit:

1. A11y browser action model exists.
   - Evidence: `src/a11y_snapshot.ts`, `src/browser/actions.ts`, MCP browser tools.
   - Missing: stronger iframe/shadow DOM support, React tree introspection, SPA navigation helpers, Web Vitals, init scripts, resource route filtering.

2. Native terminal engine exists.
   - Evidence: `src/terminal/*`, terminal resume tests.
   - Missing: full browser-rendered terminal UI using wterm/localterm-style DOM-native rendering.

3. Browser terminal view is partial.
   - Evidence: `src/terminal/render.ts`, dashboard terminal pages.
   - Missing: full VT renderer, DOM-native terminal input, multiplexed panes, real keyboard handling, resize, copy/paste, session attach/detach UI.

4. Stable local service names exist only as Browser Control native service refs.
   - Evidence: `src/services/*`, `bc://name`, service register/resolve commands.
   - Missing: Portless-style `.localhost` proxy, HTTPS CA, hidden random ports, OS startup, worktree subdomains, Tailscale/public sharing.

5. Remote browser providers are partial.
   - Evidence: `src/providers/local.ts`, `src/providers/custom.ts`, `src/providers/browserless.ts`.
   - Missing: Browserbase provider, provider health scoring, provider marketplace, provider policy profiles.

6. Workflow graph exists as v1 linear runtime.
   - Evidence: `src/workflows/*`.
   - Missing: conditional branching, loops, typed state transitions, graph UI editor, event streaming, LangGraph-style persistence/state editing.

7. Self-healing harness exists as v1 registry/sandbox.
   - Evidence: `src/harness/*`.
   - Missing: agent helper generation loop, hot-load execution adapter, browser replay validation tests, Docker/CubeSandbox/E2B providers.

8. Automation packages exist as local v1.
   - Evidence: `src/packages/*`, `automation-packages/tradingview-ict-analysis/`.
   - Missing: remote registry/marketplace, package signing, trust review workflow, generated package config UI, remote package sources.

9. Package eval proof is partial.
   - Evidence: `src/packages/eval.ts`, `src/benchmarks/*`.
   - Missing: real benchmark suites, browser-use/Webwright comparison tasks, pass-rate dashboard.

10. Dashboard/generated UI is partial.
    - Evidence: `web/src/App.tsx`, `src/web/server.ts`, `src/operator/generated_ui.ts`.
    - Missing: json-render runtime/devtools/directives/catalog, generated package config UI, polished terminal/dashboard workflows.

11. Credential safety is partial.
    - Evidence: redaction, policy credential gate, data-home `secrets/` folder.
    - Missing: real credential vault, OS keychain/DPAPI, per-site grants, reveal/typing approvals, rotation, secret-use audit UI.

12. Privacy/network control is partial.
    - Evidence: `src/browser/network_interceptor.ts`, `src/observability/network_capture.ts`, blocked-domain policy.
    - Missing: uBlock/Pi-hole-style filter-list engine, subscriptions, tracker/ad profiles, request audit UI, DNS/proxy rule packs.

13. Memory/site knowledge exists as v1.
    - Evidence: `src/knowledge/*`.
    - Missing: Qdrant/PageIndex backend, semantic ranking, stale locator scoring, package-level memory sync.

14. Local model/provider routing is partial.
    - Evidence: `src/ai_agent.ts`, OpenRouter/Stagehand config.
    - Missing: Ollama provider, OpenAI-compatible local API, multi-provider router, fallback graph, provider settings UI.

15. Record/replay builder is partial.
    - Evidence: `src/observability/screencast.ts`.
    - Missing: workflow recorder that converts live browser/terminal/fs actions into package/workflow drafts.

16. Visual diff/debug is partial.
    - Evidence: screenshots, debug bundles, screencast receipts, `src/snapshot_diff.ts`.
    - Missing: screenshot pixel diff, DOM structural diff, before/after visual comparison, visual regression gates, replay debugger.

17. CAPTCHA solver exists.
    - Evidence: `src/captcha_solver.ts`, `tests/unit/captcha_solver.test.ts`.
    - Missing: Cap-style proof-of-work anti-abuse for public marketplace/API. Do not confuse this with CAPTCHA solving.

18. Stealth controls are partial and opt-in.
    - Evidence: `src/stealth.ts`.
    - Missing: Camofox/Cloak/Obscura providers. These are risky. Do not make them default.

==================================================
FEATURE PRIORITY ORDER
==================================================

Implement missing features in this order unless the user explicitly changes priority:

1. Credential Vault and Privacy Network Control.
2. Browser Terminal and Dashboard polish.
3. Workflow Graph v2 and Self-Healing Harness generation.
4. Automation Package Marketplace, signing, trust review, and eval proof.
5. Local Model Provider Router and OpenAI-compatible local API.
6. Record/Replay Automation Builder and Site Memory upgrade.
7. Visual Diff, Replay Debugger, and Audit Viewer.
8. Optional Portless-style `.localhost` proxy.
9. Browserbase provider and provider health scoring.
10. Later-only experiments: CubeSandbox, Qdrant/PageIndex, Cap anti-abuse, zero-native, Rolldown, deepsec, react-doctor.

==================================================
FEATURE IMPLEMENTATION INSTRUCTIONS
==================================================

## Feature 1: Credential Vault and Privacy Network Control

Goal:

Make Browser Control safe for logged-in automation by adding real secret storage and policy-managed network privacy.

Already exists:

- redaction helpers
- policy credential gate
- config sensitive-key redaction
- network capture
- request intercept/block/mock/capture primitives
- blocked-domain policy concept

Do not rebuild these. Extend them.

Read first:

1. `src/policy/profiles.ts`
2. `src/session_manager.ts`
3. `src/observability/redaction.ts`
4. `src/browser/network_interceptor.ts`
5. `src/observability/network_capture.ts`
6. `src/shared/config.ts`
7. `src/shared/paths.ts`
8. `src/web/server.ts`
9. `web/src/pages/SettingsView.tsx`
10. `docs/production-upgrade/UPSTREAM-SOURCES.md`

Implement:

1. Add a credential vault abstraction.
   - File target: `src/security/credential_vault.ts` or equivalent.
   - Support at least local encrypted storage or OS-backed storage where available.
   - On Windows, prefer DPAPI/keytar-style OS protection if dependency choice is acceptable.
   - If OS vault is not available, provide a clearly named local fallback with warnings.
   - Store secrets outside repo.
   - Never store plain secrets in debug logs, audit logs, screenshots, package manifests, or workflow graph files.

2. Add secret references.
   - Use stable IDs like `secret://site/name`.
   - Workflows/packages should request a secret reference, not raw value.
   - Browser/terminal actions must require policy approval before typing/revealing secret values.

3. Add per-site and per-package secret grants.
   - Grant shape must include package/workflow/site/action scope.
   - Grant must be auditable.
   - Revocation must be possible.

4. Add secret-use audit events.
   - Log secret ID, action type, target site/package/workflow, timestamp, policy decision.
   - Never log raw value.

5. Add network filter engine v1.
   - Use existing request interception primitives.
   - Support allowlist/denylist domains.
   - Support resource type rules when available.
   - Support tracker/ad/analytics profile lists.
   - Start with a small native format. Do not copy uBlock GPL code.

6. Add policy profiles.
   - Safe profile: strict third-party/tracker blocking.
   - Balanced profile: block common trackers/analytics.
   - Trusted profile: audit only unless configured.

7. Add dashboard UI.
   - Show vault entries without values.
   - Show network rules.
   - Show recent blocked requests.
   - Show secret-use audit.
   - Require explicit confirmation for reveal/delete/revoke actions.

8. Add CLI/API/MCP surface only where useful.
   - `bc vault list`
   - `bc vault set`
   - `bc vault delete`
   - `bc network rules list`
   - `bc network rules add`
   - Keep MCP tools minimal and policy-gated.

Verify:

```text
npm run typecheck
npm test
npm run test:security
npm run test:web
```

Product verification:

1. Add a test secret.
2. Confirm config/list/debug output redacts it.
3. Use it in a controlled browser form only after approval.
4. Confirm audit event appears.
5. Add a tracker/domain block rule.
6. Open a page that requests the blocked domain.
7. Confirm request is blocked and visible in audit/UI.
8. Confirm no raw secret appears in logs, screenshots, debug bundles, receipts, terminal serialization, or package eval output.

## Feature 2: Browser Terminal and Dashboard Polish

Goal:

Add a real browser terminal in the dashboard backed by Browser Control PTY sessions.

Already exists:

- native terminal engine
- terminal resume
- terminal render adapter
- dashboard and web server

Do not replace the terminal engine. The browser terminal is UI/render/control layer only.

Read first:

1. `src/terminal/*`
2. `src/terminal/render.ts`
3. `src/runtime/daemon.ts`
4. `src/web/server.ts`
5. `src/web/events.ts`
6. `web/src/App.tsx`
7. `web/src/pages/CommandView.tsx`
8. `web/src/pages/AdvancedView.tsx`
9. `desktop/main.cjs`
10. `docs/web-desktop-wrapper/*`

Implement:

1. Add terminal session list and attach UI.
2. Add full terminal pane.
   - Render ANSI/VT properly.
   - Preserve selectable text.
   - Support keyboard input.
   - Support paste with confirmation for multiline/destructive commands.
   - Support resize.
   - Support copy.
   - Support clear.
   - Support reconnect/resume.
3. Prefer wterm/localterm-style rendering if a dependency is stable and license-compatible.
4. Keep PTY ownership in Browser Control backend.
5. Expose semantic DOM rows for a11y snapshots.
6. Add terminal event streaming through existing web event system.
7. Add loading/empty/error states.
8. Add mobile layout.

Verify:

```text
npm run typecheck
npm run web:typecheck
npm run web:build
npm run test:web
npm run test:terminal
```

Product verification:

1. Start dashboard.
2. Open browser terminal.
3. Create terminal session.
4. Run `pwd`/`dir`.
5. Run a long command and confirm streaming output.
6. Resize viewport.
7. Refresh dashboard and confirm terminal resumes.
8. Close session and confirm child process cleanup.
9. Capture desktop and mobile screenshots.

## Feature 3: Workflow Graph v2 and Self-Healing Harness Generation

Goal:

Turn the current linear workflow runtime and helper registry into a durable graph + self-healing helper system.

Already exists:

- workflow graph v1
- workflow runtime/store
- approval node
- retry policy
- helper node executor hook
- harness registry
- helper validation
- local-temp sandbox

Do not create a second workflow engine.

Read first:

1. `src/workflows/types.ts`
2. `src/workflows/runtime.ts`
3. `src/workflows/store.ts`
4. `src/harness/types.ts`
5. `src/harness/registry.ts`
6. `src/harness/sandbox.ts`
7. `src/packages/runner.ts`
8. `src/runtime/daemon.ts`
9. `src/mcp/tools/workflow.ts`
10. `src/operator/generated_ui.ts`

Implement:

1. Add graph branching.
   - Conditional edge expressions must be typed and safe.
   - No arbitrary JS eval.
   - Keep validation strict.

2. Add loops with guardrails.
   - Max loop count.
   - Timeout.
   - state-change requirement or retry policy.

3. Add typed workflow state.
   - Persist state after each node.
   - Allow safe human edit for approved fields only.
   - Add state schema validation.

4. Add event streaming.
   - Emit node started/completed/failed/retried/paused/resumed.
   - Expose to dashboard.

5. Add self-healing helper generation loop.
   - Detect repeat failure.
   - Generate helper into isolated harness area, not core source.
   - Validate static safety.
   - Run in sandbox.
   - Replay against controlled browser state when possible.
   - Activate only after tests pass.
   - Keep rollback.

6. Add hot-load helper execution adapter.
   - Workflow helper nodes can call activated helper by ID/version.
   - Package permissions must allow helper use.
   - Policy must audit helper execution.

7. Add sandbox provider interface.
   - Keep local-temp default.
   - Add extension points for Docker/CubeSandbox/E2B later.
   - Do not implement heavy CubeSandbox unless user asks.

Verify:

```text
npm run typecheck
npm test
node --require ts-node/register --require tsconfig-paths/register --test tests/unit/workflows.test.ts tests/unit/harness.test.ts tests/unit/packages.test.ts
```

Product verification:

1. Create workflow with branch.
2. Create workflow with loop and max-loop guard.
3. Pause for approval, edit allowed state, resume.
4. Force helper failure.
5. Generate helper in sandbox.
6. Validate helper.
7. Activate helper.
8. Re-run workflow and confirm success.
9. Confirm rollback works.

## Feature 4: Automation Package Marketplace, Signing, Trust Review, and Eval Proof

Goal:

Move local automation packages from v1 local install to a safe marketplace-ready package system.

Already exists:

- local package install/list/info/update/remove/grant/run/eval
- package permission model
- package manifest validation
- package eval runner
- one example package

Do not break local packages.

Read first:

1. `src/packages/types.ts`
2. `src/packages/manifest.ts`
3. `src/packages/registry.ts`
4. `src/packages/runner.ts`
5. `src/packages/eval.ts`
6. `src/operator/generated_ui.ts`
7. `src/policy/profiles.ts`
8. `src/web/server.ts`
9. `web/src/pages/*`
10. `automation-packages/tradingview-ict-analysis/`

Implement:

1. Add remote package source abstraction.
   - Local directory stays supported.
   - Remote registry source is optional/configured.
   - No arbitrary remote execution without trust review.

2. Add package signing/trust metadata.
   - signer
   - digest
   - signature
   - trusted/untrusted state
   - install time
   - source URL

3. Add trust review workflow.
   - Show permissions.
   - Show files.
   - Show generated UI spec.
   - Show risk summary.
   - Require user confirmation for high-risk install/grant.

4. Add generated package config UI.
   - Use existing `uiSpec` validation.
   - Optionally integrate json-render runtime later.
   - Do not allow arbitrary component/action execution.

5. Add eval proof dashboard.
   - Show package eval pass/fail history.
   - Show last run duration.
   - Show failed step.
   - Show debug receipt link.

6. Add package search/list/update UX.
   - CLI first.
   - Dashboard second.
   - MCP only if policy-safe.

Verify:

```text
npm run typecheck
npm test
npm run test:package
npm run test:web
```

Product verification:

1. Install local package.
2. Install from test remote registry.
3. Reject untrusted/unsigned package.
4. Review permissions.
5. Grant minimum permission.
6. Render config UI.
7. Run package.
8. Run package eval.
9. Confirm dashboard shows evidence.

## Feature 5: Local Model Provider Router and OpenAI-Compatible Local API

Goal:

Let users run Browser Control with local/offline models and expose Browser Control as a local automation backend.

Already exists:

- `src/ai_agent.ts`
- OpenRouter config
- Stagehand hooks
- cost cap
- provider registry for browsers, not models

Do not confuse browser providers with model providers.

Read first:

1. `src/ai_agent.ts`
2. `src/shared/config.ts`
3. `src/runtime/health_check.ts`
4. `src/operator/doctor.ts`
5. `src/web/server.ts`
6. `web/src/pages/SettingsView.tsx`
7. `src/policy/profiles.ts`

Implement:

1. Add model provider abstraction.
   - OpenRouter provider.
   - Ollama provider.
   - OpenAI-compatible custom endpoint provider.
   - Optional LM Studio/LocalAI via OpenAI-compatible endpoint.

2. Add router.
   - priority order
   - fallback on provider failure
   - cost cap
   - local-only mode
   - model capability metadata

3. Add config.
   - CLI set/list.
   - dashboard settings.
   - sensitive values redacted.

4. Add local OpenAI-compatible API.
   - Loopback-only by default.
   - Token required.
   - Route model requests through provider router.
   - Tool calls can invoke Browser Control only through policy-gated runtime.

5. Add doctor checks.
   - Ollama reachable.
   - custom endpoint reachable.
   - API key present if needed.
   - local API bound to loopback.

Verify:

```text
npm run typecheck
npm test
npm run test:web
```

Product verification:

1. Configure OpenRouter.
2. Configure Ollama if installed.
3. Configure custom OpenAI-compatible endpoint.
4. Force primary provider failure and confirm fallback.
5. Start local API.
6. Send chat request.
7. Confirm auth required.
8. Confirm non-loopback exposure is denied unless explicitly enabled.

## Feature 6: Record/Replay Automation Builder and Site Memory Upgrade

Goal:

Let a user perform a workflow once, then turn it into a durable workflow/package draft.

Already exists:

- screencast/action timeline
- debug receipts
- knowledge system
- workflow runtime
- package system

Read first:

1. `src/observability/screencast.ts`
2. `src/observability/debug_bundle.ts`
3. `src/knowledge/*`
4. `src/workflows/*`
5. `src/packages/*`
6. `src/browser/actions.ts`
7. `src/a11y_snapshot.ts`

Implement:

1. Add recorder mode.
   - Capture browser actions.
   - Capture terminal actions.
   - Capture filesystem actions.
   - Capture approvals.
   - Redact secrets.

2. Add replay model.
   - Convert recorded actions to workflow draft.
   - Prefer semantic refs/roles/names over raw coordinates/selectors.
   - Store assertions after important actions.
   - Record wait conditions.

3. Add package draft generator.
   - Manifest.
   - Permissions.
   - uiSpec stub.
   - eval definition.

4. Add site memory upgrade.
   - Use existing knowledge store.
   - Add stale locator scoring.
   - Add optional semantic ranking.
   - Keep Qdrant/PageIndex as optional later adapters, not required default.

5. Add replay debugger.
   - Show step-by-step replay result.
   - Link to screenshot/debug receipt.

Verify:

```text
npm run typecheck
npm test
npm run test:browser-features
```

Product verification:

1. Record a simple browser workflow.
2. Convert to workflow draft.
3. Replay it.
4. Convert to package draft.
5. Run package eval.
6. Confirm no secrets were captured.

## Feature 7: Visual Diff, Replay Debugger, and Audit Viewer

Goal:

Make failures explainable with before/after evidence and user-readable audit trails.

Already exists:

- screenshots
- debug bundles
- screencast receipts
- a11y snapshot diff
- audit logs

Read first:

1. `src/snapshot_diff.ts`
2. `src/observability/debug_bundle.ts`
3. `src/observability/screencast.ts`
4. `src/policy/audit.ts`
5. `src/web/server.ts`
6. `web/src/pages/*`

Implement:

1. Add screenshot pixel diff.
   - Use stable image diff dependency if license-compatible.
   - Store diff artifact under data home/reports, not repo.

2. Add DOM structural diff.
   - Keep separate from a11y snapshot diff.
   - Redact sensitive text where possible.

3. Add before/after comparison UI.
   - screenshot before
   - screenshot after
   - pixel diff
   - a11y diff
   - DOM diff summary

4. Add replay debugger.
   - Step timeline.
   - Inputs.
   - Outputs.
   - Policy decisions.
   - Retries.
   - Helper used.

5. Add audit viewer.
   - Filter by session/workflow/package/action/risk.
   - Show redacted details only.

Verify:

```text
npm run typecheck
npm test
npm run test:web
```

Product verification:

1. Run workflow with one successful browser action.
2. Capture before/after.
3. Confirm diff artifact exists.
4. Force a failure.
5. Open replay debugger.
6. Confirm audit viewer shows policy decision.
7. Confirm secrets are redacted.

## Feature 8: Optional Portless-Style `.localhost` Proxy

Goal:

Add stable human-friendly local URLs without replacing `bc://name`.

Already exists:

- service registry
- service resolver
- dev server detection
- `bc://name`

Read first:

1. `src/services/registry.ts`
2. `src/services/resolver.ts`
3. `src/services/detector.ts`
4. `src/proxy_manager.ts`
5. `src/shared/config.ts`
6. `src/operator/doctor.ts`
7. `src/web/server.ts`

Implement:

1. Keep `bc://name` default for agents.
2. Add optional `.localhost` proxy mode.
3. Support:
   - `https://myapp.localhost`
   - hidden/random backend ports
   - stable service names
   - worktree subdomains
   - OS startup only if user enables it
4. HTTPS/local CA is optional and must be explicit.
5. Tailscale/public sharing is later-only unless user asks.
6. Add doctor checks for port 80/443 conflicts and cert status.
7. Add clear failure messages on Windows permission issues.

Verify:

```text
npm run typecheck
npm test
```

Product verification:

1. Register service on random port.
2. Resolve `bc://name`.
3. Enable `.localhost` proxy.
4. Open `http://name.localhost` or `https://name.localhost`.
5. Restart service on a different backend port.
6. Confirm stable URL still works.
7. Disable proxy and confirm cleanup.

## Feature 9: Browserbase Provider and Provider Health Scoring

Goal:

Improve remote browser provider support without making remote providers mandatory.

Already exists:

- local provider
- custom CDP provider
- Browserless provider
- provider CLI/MCP/API

Read first:

1. `src/providers/interface.ts`
2. `src/providers/registry.ts`
3. `src/providers/local.ts`
4. `src/providers/custom.ts`
5. `src/providers/browserless.ts`
6. `src/browser/connection.ts`
7. `src/operator/doctor.ts`

Implement:

1. Add Browserbase provider adapter if current Browserbase API/license fits.
2. Add provider health checks.
   - auth valid
   - endpoint reachable
   - launch supported
   - attach supported
   - latency
   - recent failures
3. Add provider scoring.
   - Used for diagnostics first.
   - Do not auto-switch providers unless configured.
4. Add dashboard provider status.
5. Add policy profile for remote providers.
6. Keep tokens redacted.

Verify:

```text
npm run typecheck
npm test
npm run test:browser-features
```

Product verification:

1. List providers.
2. Add fake/custom provider.
3. Confirm health failure is readable.
4. Add valid provider if credentials exist.
5. Launch/attach.
6. Confirm cleanup.

## Later-Only Feature Notes

Do not implement these unless the user explicitly asks:

1. CubeSandbox/E2B provider.
   - Design interface now.
   - Heavy runtime later.

2. Qdrant/PageIndex memory backend.
   - Current markdown knowledge system exists.
   - Add optional adapter only after record/replay and site memory need ranking.

3. Cap proof-of-work anti-abuse.
   - Only useful for public marketplace/API.
   - Not needed for local core.

4. zero-native.
   - Study for future shell.
   - Electron exists now.

5. Rolldown.
   - Adopt only if Vite migration is easy and measurable.

6. deepsec.
   - Study for future security audit harness.
   - Do not add giant agent fanout now.

7. react-doctor.
   - Optional CI/dev check for dashboard.
   - Do not block core without user approval.

8. Camofox/Cloak/Obscura.
   - Risky anti-detect providers.
   - Never default.
   - Require explicit opt-in, policy warnings, and abuse-risk docs.

==================================================
CURRENT VERIFIED FAILURES
==================================================

The last review found these real failures. Fix them. Do not mark them complete until verified.

1. Biome fails.
   - Command:

```text
npx biome check . --max-diagnostics=30
```

   - Current failures:
     - `web/src/App.tsx:129` uses `role="button"` on a div/backdrop where Biome asks for semantic elements.
     - `web/src/App.tsx:201` hamburger SVG is missing a title or proper accessibility hiding.

2. Mobile UI is still broken.
   - File:

```text
reports/ui-verification/sidebar-mobile.png
```

   - It shows the command page improved, but right-side cards/content still overflow horizontally and are clipped offscreen.
   - A screenshot existing is not proof. The screenshot must show a usable layout.

3. Desktop UI screenshot claim is false.
   - `premium-completion-tracker.md` claims:

```text
reports/ui-verification/desktop-app-offscreen.png
```

   - Actual `reports/ui-verification/` contains only:

```text
sidebar-desktop.png
sidebar-mobile.png
sidebar-after-hard-refresh.png
```

   - A separate file was found at:

```text
scripts/reports/ui-verification/desktop-app-offscreen.png
```

   - That image is blank white and does not verify desktop UI.

4. Desktop processes were left running.
   - Review found `Browser Control.exe` processes still alive after the agent claimed cleanup.
   - Example PIDs found: `25252`, `25572`, `34804`, `2324`.
   - Final verification must not leave orphan `Browser Control.exe` processes started by this task.

5. `npm run web:serve` still hit the real malformed MemoryStore DB.
   - Latest transcript still showed:

```text
Runtime malformed database error in MemoryStore: database disk image is malformed. Attempting recovery...
Failed to quarantine corrupt database: EBUSY...
Failed to load persisted sessions: database disk image is malformed
```

   - The previous agent then marked this complete. That is false.
   - Either fix this safely or document it as a blocker with exact evidence and a safe manual recovery path.

6. Screenshot helper was removed instead of fixed.
   - `scripts/capture_ui_screenshots.cjs` is currently missing.
   - `scripts/capture_desktop_offscreen.cjs` is currently missing.
   - Requirement was to make screenshot capture fail clearly on error, not delete the helper while still relying on screenshots.

7. Tracker is still inaccurate.
   - `premium-completion-tracker.md` says everything is complete.
   - It claims Biome clean even though Biome fails.
   - It claims desktop evidence that is missing/blank.
   - It marks runtime malformed DB fixed even though `web:serve` still showed it.

==================================================
REQUIRED READING ORDER
==================================================

Before editing anything, read every file below in order. Do not skip any file.

1. `INSTRUCTIONS.md`
2. `premium-completion-tracker.md`
3. `package.json`
4. `web/package.json`
5. `web/src/App.tsx`
6. `web/src/App.css`
7. `web/src/index.css`
8. `web/src/pages/CommandView.tsx`
9. `web/src/pages/SettingsView.tsx`
10. `web/src/pages/AdvancedView.tsx`
11. `src/shared/sqlite_util.ts`
12. `src/runtime/memory_store.ts`
13. `src/session_manager.ts`
14. `src/browser_control.ts`
15. `src/shared/paths.ts`
16. `src/state/sqlite.ts`
17. `tests/unit/sqlite_recovery.test.ts`
18. `tests/unit/sqlite_storage.test.ts`
19. `tests/unit/state_storage.test.ts`
20. `tests/unit/desktop_security.test.ts`
21. `tests/unit/web_frontend_format.test.ts`
22. `tests/unit/web_app_server.test.ts`
23. `desktop/main.cjs`
24. `desktop/preload.cjs`
25. `desktop/security.cjs`

After these, inspect directly related files as needed.

==================================================
IMPLEMENTATION REQUIREMENTS
==================================================

## 1. Fix Biome Failures

Current failing command:

```text
npx biome check . --max-diagnostics=30
```

Required fixes:

1. Fix the sidebar backdrop accessibility issue in `web/src/App.tsx`.
   - Do not use a div with `role="button"` when Biome requires a semantic element.
   - Prefer a real `<button type="button">` backdrop or another accessible semantic structure.
   - Keep click-to-close and Escape-to-close behavior if present.
   - Ensure the backdrop has an accessible label if it is interactive.

2. Fix hamburger SVG accessibility.
   - If the button already has `aria-label="Toggle navigation"`, the SVG can be decorative.
   - Add `aria-hidden="true"` and `focusable="false"` to the SVG, or otherwise satisfy Biome with a valid title/label.

Verification:

```text
npx biome check . --max-diagnostics=30
```

Must exit 0.

## 2. Fix Mobile Horizontal Overflow

Current evidence:

`reports/ui-verification/sidebar-mobile.png` still shows right-side content clipped offscreen.

Required behavior at 375x812 viewport:

1. No horizontal page overflow.
2. No clipped right-side panels.
3. Command page main content must fit within viewport.
4. Cards/panels that are side-by-side on desktop must stack on mobile.
5. Buttons must fit their containers.
6. Text must remain readable and not overlap.
7. Header must fit: hamburger, title, and health/status must not crowd or clip.

Likely fixes:

- Add mobile media queries for dashboard/page grids.
- Ensure `.workspace-content`, page containers, panels, and cards use `min-width: 0`.
- Convert desktop multi-column layouts to one column under `768px`.
- Avoid fixed widths wider than the viewport.
- Add `max-width: 100%` to panels/textareas/cards as needed.
- Consider hiding or compacting nonessential right-side metric cards on small screens only if the page remains useful.

Files likely involved:

- `web/src/App.css`
- `web/src/index.css`
- `web/src/pages/CommandView.tsx`
- possibly other `web/src/pages/*.tsx` if shared page layouts overflow

Verification:

Capture a fresh mobile screenshot:

```text
reports/ui-verification/sidebar-mobile.png
```

The screenshot must visibly show no horizontal clipping. If you can programmatically verify `document.documentElement.scrollWidth <= window.innerWidth`, do so and record the evidence.

## 3. Restore/Fix Screenshot Capture Helper

Problem:

Screenshot helper scripts were deleted or not left in the repo even though screenshots are required.

Required behavior:

1. Create or restore a durable helper script:

```text
scripts/capture_ui_screenshots.cjs
```

2. The script must:
   - accept a URL argument
   - create `reports/ui-verification/`
   - capture desktop screenshot
   - capture mobile screenshot at 375x812
   - capture after-refresh screenshot
   - verify each output file exists and is nonempty
   - exit nonzero on any failure
   - close the browser in `finally`

3. Do not leave helper output under `scripts/reports/`.
4. Do not swallow errors with `console.error` and exit 0.
5. If using Playwright, keep it isolated to screenshot capture only. For Browser Control product verification, prefer Browser Control MCP when practical, but a small deterministic screenshot helper is acceptable.

Required output files:

```text
reports/ui-verification/sidebar-desktop.png
reports/ui-verification/sidebar-mobile.png
reports/ui-verification/sidebar-after-hard-refresh.png
```

Verification:

Run the helper against the live local web URL and confirm all output files exist and are nonempty.

## 4. Fix Or Honestly Document Runtime Malformed DB Recovery

Problem:

`npm run web:serve` still printed the malformed DB warning for the real user data home.

Required steps:

1. Check for existing Browser Control, Node, Electron, or MCP processes that may hold:

```text
C:\Users\11\.browser-control\memory\memory.sqlite
```

2. Do not kill unrelated user processes blindly. If you started a process in this task, you may stop it during cleanup. If another long-running MCP/server process is holding the DB, document it.

3. Run:

```text
npm run web:serve
```

4. Read startup output.

5. If the malformed DB warning no longer appears:
   - document exact clean output in `premium-completion-tracker.md`
   - stop the server you started

6. If the malformed DB warning still appears:
   - do not call it complete
   - investigate what holds the DB lock
   - if safe automated recovery is possible, implement it
   - if not safe, document exact blocker and safe manual recovery path in `premium-completion-tracker.md`

Safe manual recovery path must include:

1. Stop Browser Control processes that hold the DB.
2. Move, not delete:

```text
C:\Users\11\.browser-control\memory\memory.sqlite
C:\Users\11\.browser-control\memory\memory.sqlite-wal
C:\Users\11\.browser-control\memory\memory.sqlite-shm
```

3. Move them into:

```text
C:\Users\11\.browser-control\reports\sqlite-recovery\<timestamp-or-id>\
```

4. Write/preserve `recovery-report.json`.
5. Restart only after move succeeds.

Do not:

- delete the DB
- hide the issue by using an isolated data home for `web:serve`
- mark complete if default `web:serve` still prints the malformed DB warning

Files likely involved:

- `src/runtime/memory_store.ts`
- `src/shared/sqlite_util.ts`
- `src/session_manager.ts`
- `src/web/server.ts`
- `premium-completion-tracker.md`

## 5. Fix Desktop UI Verification

Problem:

Desktop verification is currently invalid:

- expected report screenshot is missing
- offscreen screenshot was saved under `scripts/reports/...`
- offscreen screenshot is blank white
- Browser Control desktop processes were left alive

Required behavior:

1. Build desktop:

```text
npm run desktop:build
```

2. Verify the desktop UI, not only process existence.

Preferred artifact:

```text
reports/ui-verification/desktop-sidebar.png
```

The screenshot must show actual Browser Control UI, not blank white.

Acceptable alternatives if a real desktop screenshot is impossible:

1. Document exact blocker in `premium-completion-tracker.md`.
2. Include:
   - command run
   - executable path
   - process evidence
   - app logs if available
   - why screenshot capture is blocked
   - whether the window was visible
   - cleanup evidence

Process cleanup required:

After desktop verification, run a check equivalent to:

```powershell
Get-Process "Browser Control" -ErrorAction SilentlyContinue
```

If processes you started remain, stop them. Final state must not leave orphan `Browser Control.exe` processes from this verification.

Do not:

- claim desktop UI verified from `Get-Process` alone
- use a blank white screenshot as evidence
- save the final artifact under `scripts/reports`
- leave `Browser Control.exe` running

## 6. Update Tracker Truthfully

File:

```text
premium-completion-tracker.md
```

Rewrite it to reflect current truth. It must include:

1. Biome status and command output summary.
2. Typecheck status.
3. Web typecheck status.
4. Web build status.
5. `scratch/count_tools.ts` status.
6. `test:state` status.
7. `test:mcp` status.
8. `test:web` status.
9. `test:desktop` status.
10. `test:ci` status.
11. `npm run build` status.
12. `npm run test:package` status.
13. `npm pack --dry-run --json` status.
14. `npm run desktop:build` status.
15. Mobile screenshot status.
16. Desktop screenshot status or exact blocker.
17. `web:serve` malformed DB status.
18. Process cleanup status.
19. Remaining blockers.

Do not mark an item complete unless evidence exists.

If any blocker remains, tracker must say so plainly.

==================================================
FINAL VERIFICATION GATES
==================================================

Run all applicable commands below before claiming completion:

```text
npx biome check . --max-diagnostics=30
npm run typecheck
npm run web:typecheck
npm run web:build
npx ts-node scratch/count_tools.ts
npm run test:state
npm run test:mcp
npm run test:web
npm run test:desktop
npm run test:ci
npm run build
npm run test:package
npm pack --dry-run --json
npm run desktop:build
```

Required artifacts:

```text
reports/ui-verification/sidebar-desktop.png
reports/ui-verification/sidebar-mobile.png
reports/ui-verification/sidebar-after-hard-refresh.png
reports/ui-verification/desktop-sidebar.png
```

If `desktop-sidebar.png` cannot be produced, the tracker must document an exact blocker with evidence. A blank screenshot is not acceptable.

Required runtime checks:

1. `npx ts-node scratch/count_tools.ts` prints tool count under 100 and no malformed DB warning.
2. `npm run web:serve` startup is checked for the real malformed DB warning.
3. Every server/process started by this task is stopped.
4. No orphan `Browser Control.exe` processes from this task remain.
5. Screenshot files exist, are nonempty, and visually show the expected UI.

==================================================
STRICT COMPLETION RULE
==================================================

Do not claim complete unless all are true:

1. Biome exits 0.
2. Mobile screenshot at 375x812 is visibly usable and not horizontally clipped.
3. Screenshot helper exists and exits nonzero on failure.
4. Web screenshots exist in `reports/ui-verification`.
5. Desktop UI screenshot exists in `reports/ui-verification/desktop-sidebar.png`, or exact blocker is documented.
6. Desktop screenshot is not blank.
7. Runtime `web:serve` malformed DB status is fixed or honestly documented as a blocker.
8. `premium-completion-tracker.md` is truthful.
9. No started Browser Control desktop processes are left running.
10. Final verification gates pass or have exact documented blockers.

If any item is not verified, result is partial or blocked, not complete.

==================================================
FINAL RESPONSE FORMAT
==================================================

When finished, respond with:

1. Status: Complete / Partial / Blocked.
2. Files changed.
3. Commands run and results.
4. Screenshot/artifact paths.
5. Process cleanup result.
6. Remaining blockers, if any.
7. Strict completion audit matching this file.

Do not say "production-ready", "fully complete", or "no blockers remain" unless the strict completion rule is fully satisfied.
