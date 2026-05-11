# Browser Control Premium: New Session Implementation Instructions

This file is the source of truth for the next AI coding session.

The previous session fixed the third-pass blocker cleanup. Do not confuse that blocker cleanup with the premium feature backlog. The blockers are verified fixed; the large premium backlog is still mostly partial or not started.

Your job in the next session is to implement the remaining premium feature backlog in the priority order below, without restarting from scratch and without breaking the verified blocker fixes.

==================================================
HIGH-LEVEL TRUTH
==================================================

Browser Control is an existing TypeScript/Node/Electron/React automation engine. It already has:

- Browser automation actions and a11y snapshots.
- Terminal engine and PTY lifecycle.
- Filesystem actions.
- MCP tool registry.
- Policy profiles and action evaluation.
- Web dashboard and Electron desktop shell.
- SQLite state storage and recovery.
- Local service registry using `bc://name`.
- Local automation package v1.
- Workflow runtime v1.
- Harness registry v1.
- Observability/debug artifacts.
- CAPTCHA solver.
- Opt-in stealth controls.

Do not create a parallel product. Extend the current architecture.

Do not claim completion from tests alone. Product verification is required.

==================================================
CURRENT VERIFIED BLOCKER CLEANUP STATUS
==================================================

These items were fixed/verified in the previous session. Do not redo them unless your new implementation breaks them.

1. Biome errors in `web/src/App.tsx`
   - Fixed.
   - `npx biome check . --max-diagnostics=30` passed.
   - Backdrop is a real `<button type="button">`.
   - Hamburger/nav SVGs are decorative with `aria-hidden="true"` and `focusable="false"`.

2. Mobile horizontal overflow
   - Fixed.
   - Fresh screenshot helper run reported:

```text
Mobile overflow check: scrollWidth=375, innerWidth=375
```

   - `reports/ui-verification/sidebar-mobile.png` is usable at 375x812.

3. Screenshot helper
   - Fixed.
   - `scripts/capture_ui_screenshots.cjs` exists.
   - It captures desktop, mobile, and after-refresh screenshots.
   - It verifies nonempty files.
   - It closes Playwright browser in `finally`.
   - It exits nonzero on failure.
   - It writes `reports/ui-verification/screenshot-manifest.json`.

4. Desktop screenshot helper
   - Fixed.
   - `scripts/capture_desktop_offscreen.cjs` exists.
   - It captures `reports/ui-verification/desktop-sidebar.png`.
   - Latest screenshot was nonblank and showed real Browser Control UI.

5. `npm run web:serve` malformed DB warning
   - Latest clean default run did not print malformed DB warning.
   - It printed only expected Node SQLite experimental warning:

```text
ExperimentalWarning: SQLite is an experimental feature
```

   - That warning is acceptable and is not the malformed DB warning.

6. Stale web server process
   - A stale `ts-node src/web/server.ts` process on port 7790 caused one `EADDRINUSE` during verification.
   - It was PID 3976 and was stopped after command-line verification.
   - Future sessions must check port 7790 before blaming `web:serve`.

7. Desktop process cleanup
   - Latest final check found no `Browser Control.exe` processes.
   - Port 7790 was also clear after verification.

8. Tracker accuracy
   - `premium-completion-tracker.md` was rewritten.
   - Treat it as the current blocker-cleanup evidence file, not as proof that backlog features are implemented.

9. Newly found observability warning
   - Real bug found and fixed in `src/browser/actions.ts`.
   - Old issue:

```text
Observability persistence failed: page?.waitForTimeout is not a function
```

   - Cause: `page?.waitForTimeout(...)` only protects against null page, not missing method. Some tests/mocks or current Playwright API shape do not provide `waitForTimeout`.
   - Fix: use a runtime-neutral `setTimeout` promise before persisting observability.
   - `npm run test:ci` passed after this fix.

10. Screenshot MD5 concern
    - `sidebar-desktop.png` and `sidebar-after-hard-refresh.png` can be bit-for-bit identical.
    - This does not prove fake evidence by itself. The UI is deterministic after reload.
    - `screenshot-manifest.json` now records separate capture timestamps, title, URL, file path, and byte size for the post-refresh capture.
    - If you need stronger proof, add a harmless manifest/event log, not visual noise in screenshots.

==================================================
KNOWN NON-BLOCKING CURRENT ISSUE
==================================================

`npm run test:browser-features` is not part of the final blocker gates, but it currently has live managed-Chrome failures on Windows with profile lock errors like:

```text
The process cannot access the file because it is being used by another process.
'...\\Default\\Network'
```

This indicates live managed-browser tests may reuse or collide with a profile path. Do not ignore it if you touch browser provider/session/profile code. If your feature touches browser launch, profiles, providers, or live browser lifecycle, investigate and fix this. If your feature does not touch that area, document it as pre-existing/non-blocking.

==================================================
ABSOLUTE RULES
==================================================

1. Work only inside this repo:

```text
C:\Users\11\browser-control
```

2. Read this file completely before editing anything.

3. Read the required files in the reading order below before editing anything.

4. Do not restart from scratch.

5. Do not rewrite the React app, runtime, policy engine, terminal engine, MCP registry, SQLite state layer, or desktop shell from scratch.

6. Reuse existing architecture first.

7. Do not silently delete user data.

8. Do not delete SQLite DBs as recovery.

9. If a DB is corrupt and must be moved, quarantine it by moving files and writing a recovery report.

10. Do not fake screenshots, test output, process cleanup, or tracker status.

11. Do not claim complete if any required gate fails.

12. If any command fails, fix the cause and rerun it, or document the exact blocker with evidence.

13. If a feature cannot be safely completed in one session, leave the tracker truthful and mark status Partial, not Complete.

14. Do not use isolated fake data homes to hide default data-home failures unless a test specifically requires isolation.

15. Do not leave servers, browsers, Electron apps, PTYs, or test runners running after verification.

==================================================
NEW SESSION OBJECTIVE
==================================================

Implement the missing premium feature backlog in this priority order:

1. Credential Vault and Privacy Network Control.
2. Browser Terminal and Dashboard Polish.
3. Workflow Graph v2 and Self-Healing Harness Generation.
4. Automation Package Marketplace, Signing, Trust Review, and Eval Proof.
5. Local Model Provider Router and OpenAI-Compatible Local API.
6. Record/Replay Automation Builder and Site Memory Upgrade.
7. Visual Diff, Replay Debugger, and Audit Viewer.
8. Optional Portless-Style `.localhost` Proxy.
9. Browserbase Provider and Provider Health Scoring.
10. Later-only experiments: CubeSandbox, Qdrant/PageIndex, Cap anti-abuse, zero-native, Rolldown, deepsec, react-doctor, Camofox/Cloak/Obscura.

Do not implement later-only experiments unless the user explicitly asks.

If the session cannot complete all priority items, complete them in order and leave a precise, truthful tracker showing what remains.

==================================================
REQUIRED READING ORDER
==================================================

Read every file below before editing anything.

Core status and project context:

1. `INSTRUCTIONS.md`
2. `premium-completion-tracker.md`
3. `README.md`
4. `package.json`
5. `web/package.json`
6. `docs/production-upgrade/UPSTREAM-SOURCES.md`
7. `docs/production-upgrade/STATUS.md`

Current UI/dashboard/desktop:

8. `web/src/App.tsx`
9. `web/src/App.css`
10. `web/src/index.css`
11. `web/src/api.ts`
12. `web/src/types.ts`
13. `web/src/pages/CommandView.tsx`
14. `web/src/pages/SettingsView.tsx`
15. `web/src/pages/AdvancedView.tsx`
16. `web/src/pages/BrowserView.tsx`
17. `web/src/pages/PackagesView.tsx`
18. `web/src/pages/WorkflowsView.tsx`
19. `web/src/pages/EvidenceView.tsx`
20. `desktop/main.cjs`
21. `desktop/preload.cjs`
22. `desktop/security.cjs`

Runtime/state/session/policy:

23. `src/browser_control.ts`
24. `src/session_manager.ts`
25. `src/shared/config.ts`
26. `src/shared/paths.ts`
27. `src/shared/sqlite_util.ts`
28. `src/runtime/memory_store.ts`
29. `src/state/index.ts`
30. `src/state/sqlite.ts`
31. `src/policy/profiles.ts`
32. `src/policy/engine.ts`
33. `src/policy/audit.ts`
34. `src/observability/redaction.ts`

Browser/network/observability:

35. `src/browser/actions.ts`
36. `src/browser/connection.ts`
37. `src/browser/profiles.ts`
38. `src/browser/network_interceptor.ts`
39. `src/observability/network_capture.ts`
40. `src/observability/console_capture.ts`
41. `src/observability/debug_bundle.ts`
42. `src/observability/screencast.ts`
43. `src/snapshot_diff.ts`
44. `src/captcha_solver.ts`
45. `src/stealth.ts`

Terminal/workflow/harness/packages/services/providers/models:

46. `src/terminal/actions.ts`
47. `src/terminal/session.ts`
48. `src/terminal/render.ts`
49. `src/runtime/daemon.ts`
50. `src/web/server.ts`
51. `src/web/events.ts`
52. `src/workflows/types.ts`
53. `src/workflows/runtime.ts`
54. `src/workflows/store.ts`
55. `src/harness/types.ts`
56. `src/harness/registry.ts`
57. `src/harness/sandbox.ts`
58. `src/packages/types.ts`
59. `src/packages/manifest.ts`
60. `src/packages/registry.ts`
61. `src/packages/runner.ts`
62. `src/packages/eval.ts`
63. `src/operator/generated_ui.ts`
64. `src/services/registry.ts`
65. `src/services/resolver.ts`
66. `src/services/detector.ts`
67. `src/proxy_manager.ts`
68. `src/providers/interface.ts`
69. `src/providers/registry.ts`
70. `src/providers/local.ts`
71. `src/providers/custom.ts`
72. `src/providers/browserless.ts`
73. `src/ai_agent.ts`
74. `src/operator/doctor.ts`

Existing tests:

75. `tests/unit/sqlite_recovery.test.ts`
76. `tests/unit/sqlite_storage.test.ts`
77. `tests/unit/state_storage.test.ts`
78. `tests/unit/desktop_security.test.ts`
79. `tests/unit/web_frontend_format.test.ts`
80. `tests/unit/web_app_server.test.ts`
81. `tests/unit/browser_actions.test.ts`
82. `tests/unit/browser_connection.test.ts`
83. `tests/unit/terminal_actions.test.ts`
84. `tests/unit/workflows.test.ts`
85. `tests/unit/harness.test.ts`
86. `tests/unit/packages.test.ts`
87. `tests/unit/mcp/tool_registry.test.ts`
88. `tests/unit/captcha_solver.test.ts`

After reading, inspect directly related files as needed.

==================================================
CURRENT FEATURE TRUTH
==================================================

Use this as the starting truth. Do not downgrade implemented pieces. Do not claim missing pieces are done without evidence.

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
IMPLEMENTATION ORDER AND DETAILED REQUIREMENTS
==================================================

Implement in order. Do not skip a priority item to work on a later one.

If one priority item becomes blocked, document exact blocker with evidence, then ask the user before jumping far ahead.

==================================================
FEATURE 1: CREDENTIAL VAULT AND PRIVACY NETWORK CONTROL
==================================================

Goal:

Make Browser Control safe for logged-in automation by adding real secret storage, policy-managed secret use, and network privacy controls.

Already exists:

- redaction helpers
- policy credential gate
- config sensitive-key redaction
- data-home `secrets/` directory
- network capture
- request intercept/block/mock/capture primitives
- blocked-domain policy concept

Do not rebuild these. Extend them.

Read first for this feature:

1. `src/policy/profiles.ts`
2. `src/policy/engine.ts`
3. `src/session_manager.ts`
4. `src/observability/redaction.ts`
5. `src/browser/network_interceptor.ts`
6. `src/observability/network_capture.ts`
7. `src/shared/config.ts`
8. `src/shared/paths.ts`
9. `src/web/server.ts`
10. `web/src/pages/SettingsView.tsx`

Implement:

1. Add credential vault core.
   - Target file: `src/security/credential_vault.ts` or equivalent.
   - Store secrets outside repo, under data home.
   - Prefer Windows DPAPI or OS-backed storage if a dependency is acceptable and stable.
   - If OS vault is not available, provide a clearly named encrypted local fallback.
   - Never store raw secrets in plain JSON.
   - Never log raw secrets.
   - Never include raw secrets in screenshots, debug bundles, package manifests, workflow graph files, CLI output, MCP output, or audit details.

2. Add secret reference model.
   - Use stable IDs like:

```text
secret://site/name
secret://package/name
secret://workflow/name
```

   - Workflows/packages/browser/terminal actions should request secret references, not raw values.
   - Secret values are resolved only at execution time after policy approval.

3. Add secret grants.
   - Grant shape must include:
     - secret ID
     - site/domain scope
     - package/workflow scope
     - action scope: reveal, type, paste, use-as-header, use-as-form-value
     - created timestamp
     - optional expiry
     - revoked flag
   - Revocation must be possible.
   - Grants must be auditable.

4. Add secret-use policy decisions.
   - Safe profile: require confirmation for reveal/type/paste.
   - Balanced profile: require confirmation for reveal and cross-site use; allow audited same-site use if granted.
   - Trusted profile: allow with audit when grant exists; require confirmation for reveal.
   - No profile should allow raw secret logging.

5. Add audit events.
   - Record:
     - secret ID
     - action type
     - target site/package/workflow
     - policy decision
     - timestamp
     - session ID
   - Do not record raw value.

6. Add network filter engine v1.
   - Target file: `src/security/network_rules.ts` or equivalent.
   - Use existing request interception primitives.
   - Support allowlist/denylist domains.
   - Support resource type rules when available.
   - Support built-in tracker/analytics/ad profile lists.
   - Use a small native format. Do not copy GPL uBlock code.
   - Rule result must be auditable.

7. Add privacy policy profiles.
   - Safe: strict third-party/tracker blocking.
   - Balanced: block common trackers/analytics.
   - Trusted: audit only unless configured.

8. Add API/CLI/MCP surface.
   - CLI:
     - `bc vault list`
     - `bc vault set`
     - `bc vault delete`
     - `bc vault grants list`
     - `bc vault grants revoke`
     - `bc network rules list`
     - `bc network rules add`
     - `bc network rules remove`
   - API:
     - list entries without values
     - create/update/delete entries with confirmation
     - list/revoke grants
     - list/add/remove network rules
     - list recent blocked requests
   - MCP:
     - keep minimal and policy-gated
     - never expose raw secret values directly

9. Add dashboard UI.
   - Show vault entries without values.
   - Show grants.
   - Show network rules.
   - Show recent blocked requests.
   - Show secret-use audit events.
   - Require explicit confirmation for reveal/delete/revoke.
   - Mobile layout must fit at 375x812.

Tests:

- Add unit tests for vault storage, redaction, grants, revocation, audit events, network rules, and policy decisions.
- Add web/API tests for vault/network endpoints.
- Add CLI tests for vault/network commands.
- Add MCP tests only if MCP tools are added.

Product verification:

1. Add a test secret.
2. Confirm `config/list/debug/log` output redacts it.
3. Use it in a controlled local browser form only after approval.
4. Confirm audit event appears.
5. Add a tracker/domain block rule.
6. Open a local test page that requests the blocked domain.
7. Confirm request is blocked and visible in UI/audit.
8. Confirm no raw secret appears in logs, screenshots, debug bundles, receipts, terminal serialization, workflow files, or package eval output.

Required commands for this feature:

```text
npm run typecheck
npm test
npm run test:state
npm run test:web
npm run test:mcp
```

==================================================
FEATURE 2: BROWSER TERMINAL AND DASHBOARD POLISH
==================================================

Goal:

Add a real browser terminal in the dashboard backed by Browser Control PTY sessions.

Already exists:

- native terminal engine
- terminal resume
- terminal render adapter
- dashboard and web server

Do not replace the terminal engine. The browser terminal is a UI/render/control layer only.

Read first:

1. `src/terminal/actions.ts`
2. `src/terminal/session.ts`
3. `src/terminal/render.ts`
4. `src/runtime/daemon.ts`
5. `src/web/server.ts`
6. `src/web/events.ts`
7. `web/src/App.tsx`
8. `web/src/pages/CommandView.tsx`
9. `web/src/pages/AdvancedView.tsx`
10. `desktop/main.cjs`

Implement:

1. Add terminal session list API.
   - List sessions.
   - Create session.
   - Attach to session.
   - Read session snapshot.
   - Write input.
   - Resize.
   - Close.

2. Add terminal event streaming.
   - Use existing web event system.
   - Stream terminal output to browser clients.
   - Dispose subscriptions on server close.
   - Avoid duplicate subscriptions.

3. Add browser terminal UI.
   - Session list.
   - Attach/detach UI.
   - Terminal pane.
   - ANSI/VT rendering.
   - Selectable text.
   - Keyboard input.
   - Paste support.
   - Confirmation for multiline/destructive paste.
   - Resize support.
   - Copy support.
   - Clear output.
   - Reconnect/resume after refresh.
   - Close session.
   - Loading/empty/error states.
   - Mobile layout.

4. Accessibility:
   - Expose semantic rows or meaningful text representation for a11y snapshots.
   - Buttons must have labels.
   - Keyboard focus must be usable.

5. Dashboard polish:
   - Add error boundaries or contained error states for complex pages.
   - Add visible loading/empty states.
   - Avoid UI cards inside UI cards.
   - Avoid mobile overflow.
   - Keep existing dark/light theme.

Tests:

- Unit/API tests for terminal endpoints.
- Web tests for event stream payloads.
- Terminal tests for resize/input/read/close.
- Frontend formatting/state tests where practical.

Product verification:

1. Start dashboard.
2. Open browser terminal.
3. Create terminal session.
4. Run `pwd` or `dir`.
5. Run a long command and confirm streaming output.
6. Resize viewport and confirm terminal resizes.
7. Refresh dashboard and confirm terminal resumes.
8. Test copy/paste.
9. Close session and confirm child process cleanup.
10. Capture desktop and mobile screenshots.

Required commands:

```text
npm run typecheck
npm run web:typecheck
npm run web:build
npm run test:web
npm run test:terminal
```

If `test:terminal` does not exist, add the right script or run the exact terminal test files and update `package.json` truthfully.

==================================================
FEATURE 3: WORKFLOW GRAPH V2 AND SELF-HEALING HARNESS GENERATION
==================================================

Goal:

Turn the current linear workflow runtime and helper registry into a durable graph plus self-healing helper system.

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

1. Graph branching.
   - Conditional edge expressions must be typed and safe.
   - No arbitrary JS `eval`.
   - Validation must reject unknown state paths, unsafe expressions, and ambiguous edges.

2. Loops with guardrails.
   - Max loop count.
   - Timeout.
   - State-change requirement or explicit retry policy.
   - Clear failure if guardrail trips.

3. Typed workflow state.
   - State schema.
   - Persist state after each node.
   - Allow human edits only for approved fields.
   - Validate state before resume.

4. Event streaming.
   - Emit node started/completed/failed/retried/paused/resumed/state-updated.
   - Expose to dashboard.

5. Self-healing helper generation loop.
   - Detect repeat failure.
   - Generate helper into isolated harness area under data home, not core source.
   - Validate static safety.
   - Run in sandbox.
   - Replay against controlled browser state when possible.
   - Activate only after tests pass.
   - Keep rollback.

6. Hot-load helper execution adapter.
   - Workflow helper nodes can call activated helper by ID/version.
   - Package permissions must allow helper use.
   - Policy must audit helper execution.

7. Sandbox provider interface.
   - Keep local-temp default.
   - Add extension points for Docker/CubeSandbox/E2B later.
   - Do not implement heavy providers unless user asks.

Tests:

- Branch workflow.
- Loop workflow with max-loop guard.
- State schema validation.
- Human-edit state allow/deny.
- Event stream sequence.
- Helper generation failure/success.
- Helper rollback.

Product verification:

1. Create workflow with branch.
2. Create workflow with loop and max-loop guard.
3. Pause for approval.
4. Edit allowed state.
5. Resume.
6. Force helper failure.
7. Generate helper in sandbox.
8. Validate helper.
9. Activate helper.
10. Re-run workflow and confirm success.
11. Confirm rollback works.

Required commands:

```text
npm run typecheck
npm test
node --require ts-node/register --require tsconfig-paths/register --test tests/unit/workflows.test.ts tests/unit/harness.test.ts tests/unit/packages.test.ts
```

==================================================
FEATURE 4: AUTOMATION PACKAGE MARKETPLACE, SIGNING, TRUST REVIEW, AND EVAL PROOF
==================================================

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
9. `web/src/pages/PackagesView.tsx`
10. `automation-packages/tradingview-ict-analysis/automation-package.json`

Implement:

1. Remote package source abstraction.
   - Local directory remains supported.
   - Remote registry source is optional/configured.
   - No arbitrary remote execution without trust review.
   - Test registry can be local fixture.

2. Package signing/trust metadata.
   - signer
   - digest
   - signature
   - trusted/untrusted state
   - install time
   - source URL
   - review status

3. Trust review workflow.
   - Show permissions.
   - Show files.
   - Show generated UI spec.
   - Show risk summary.
   - Require explicit confirmation for high-risk install/grant.
   - Audit install/grant decisions.

4. Generated package config UI.
   - Use existing `uiSpec` validation.
   - Do not allow arbitrary component/action execution.
   - Render only safe supported fields.

5. Eval proof dashboard.
   - Show package eval pass/fail history.
   - Show last run duration.
   - Show failed step.
   - Show debug receipt link.

6. Package search/list/update UX.
   - CLI first.
   - Dashboard second.
   - MCP only if policy-safe.

Tests:

- Install local package.
- Install fixture remote package.
- Reject untrusted/unsigned package when policy requires trust.
- Review permissions.
- Grant minimum permission.
- Render config UI.
- Run package.
- Run package eval.
- Verify eval history persists.

Required commands:

```text
npm run typecheck
npm test
npm run test:package
npm run test:web
```

==================================================
FEATURE 5: LOCAL MODEL PROVIDER ROUTER AND OPENAI-COMPATIBLE LOCAL API
==================================================

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

1. Model provider abstraction.
   - OpenRouter provider.
   - Ollama provider.
   - OpenAI-compatible custom endpoint provider.
   - Optional LM Studio/LocalAI via OpenAI-compatible endpoint.

2. Router.
   - Priority order.
   - Fallback on provider failure.
   - Cost cap.
   - Local-only mode.
   - Model capability metadata.

3. Config.
   - CLI set/list.
   - Dashboard settings.
   - Sensitive values redacted.

4. Local OpenAI-compatible API.
   - Loopback-only by default.
   - Token required.
   - Route model requests through provider router.
   - Tool calls can invoke Browser Control only through policy-gated runtime.

5. Doctor checks.
   - Ollama reachable.
   - Custom endpoint reachable.
   - API key present if needed.
   - Local API bound to loopback.

Tests:

- Provider selection.
- Fallback.
- Local-only mode.
- Auth required for local API.
- Non-loopback denied unless explicitly enabled.
- Secret redaction.

Required commands:

```text
npm run typecheck
npm test
npm run test:web
```

Product verification:

1. Configure OpenRouter.
2. Configure Ollama if installed; if not installed, doctor must report readable unavailable status.
3. Configure custom OpenAI-compatible endpoint using local fixture server.
4. Force primary provider failure and confirm fallback.
5. Start local API.
6. Send chat request.
7. Confirm auth required.
8. Confirm non-loopback exposure is denied unless explicitly enabled.

==================================================
FEATURE 6: RECORD/REPLAY AUTOMATION BUILDER AND SITE MEMORY UPGRADE
==================================================

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
7. `src/terminal/actions.ts`
8. `src/filesystem/actions.ts`

Implement:

1. Recorder mode.
   - Capture browser actions.
   - Capture terminal actions.
   - Capture filesystem actions.
   - Capture approvals.
   - Redact secrets.

2. Replay model.
   - Convert recorded actions to workflow draft.
   - Prefer semantic refs/roles/names over raw coordinates/selectors.
   - Store assertions after important actions.
   - Record wait conditions.

3. Package draft generator.
   - Manifest.
   - Permissions.
   - UI spec stub.
   - Eval definition.

4. Site memory upgrade.
   - Use existing knowledge store.
   - Add stale locator scoring.
   - Add optional semantic ranking.
   - Keep Qdrant/PageIndex as optional later adapters, not default.

5. Replay debugger integration.
   - Show step-by-step replay result.
   - Link screenshot/debug receipt.

Tests:

- Record browser workflow.
- Record terminal/fs action.
- Redact secret.
- Convert to workflow draft.
- Replay draft.
- Convert to package draft.
- Eval package.

Required commands:

```text
npm run typecheck
npm test
npm run test:browser-features
```

If `npm run test:browser-features` still fails because of pre-existing Windows profile lock, either fix it if related or document exact blocker and evidence.

==================================================
FEATURE 7: VISUAL DIFF, REPLAY DEBUGGER, AND AUDIT VIEWER
==================================================

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
6. `web/src/pages/EvidenceView.tsx`

Implement:

1. Screenshot pixel diff.
   - Use stable image diff dependency if license-compatible.
   - Store diff artifact under data home/reports or evidence, not repo.

2. DOM structural diff.
   - Keep separate from a11y snapshot diff.
   - Redact sensitive text where possible.

3. Before/after comparison UI.
   - screenshot before
   - screenshot after
   - pixel diff
   - a11y diff
   - DOM diff summary

4. Replay debugger.
   - Step timeline.
   - Inputs.
   - Outputs.
   - Policy decisions.
   - Retries.
   - Helper used.

5. Audit viewer.
   - Filter by session/workflow/package/action/risk.
   - Show redacted details only.

Tests:

- Pixel diff creates artifact.
- DOM diff redacts sensitive values.
- Audit viewer endpoint filters correctly.
- Replay debugger data shape stable.

Required commands:

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

==================================================
FEATURE 8: OPTIONAL PORTLESS-STYLE `.localhost` PROXY
==================================================

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
   - `http://myapp.localhost`
   - optional `https://myapp.localhost`
   - hidden/random backend ports
   - stable service names
   - worktree subdomains
   - OS startup only if user enables it
4. HTTPS/local CA is optional and must be explicit.
5. Tailscale/public sharing is later-only unless user asks.
6. Add doctor checks for port 80/443 conflicts and cert status.
7. Add clear Windows permission failure messages.

Tests:

- Register service on random port.
- Resolve `bc://name`.
- Enable `.localhost` proxy.
- Open stable URL.
- Restart backend on a different port.
- Stable URL still works.
- Disable proxy and confirm cleanup.

Required commands:

```text
npm run typecheck
npm test
```

==================================================
FEATURE 9: BROWSERBASE PROVIDER AND PROVIDER HEALTH SCORING
==================================================

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

1. Browserbase provider adapter if current Browserbase API/license fits.
2. Provider health checks.
   - auth valid
   - endpoint reachable
   - launch supported
   - attach supported
   - latency
   - recent failures
3. Provider scoring.
   - Diagnostics first.
   - Do not auto-switch providers unless configured.
4. Dashboard provider status.
5. Policy profile for remote providers.
6. Token redaction.

Tests:

- List providers.
- Add fake/custom provider.
- Health failure readable.
- Valid provider launch/attach when credentials exist.
- Redaction.
- Cleanup.

Required commands:

```text
npm run typecheck
npm test
npm run test:browser-features
```

==================================================
LATER-ONLY FEATURES
==================================================

Do not implement these unless the user explicitly asks:

1. CubeSandbox/E2B provider.
   - Design interfaces only if needed by self-healing harness.
   - Heavy runtime later.

2. Qdrant/PageIndex memory backend.
   - Current markdown knowledge system exists.
   - Add optional adapter only after record/replay/site memory needs ranking.

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
GENERAL IMPLEMENTATION GUIDANCE
==================================================

Architecture:

- Extend `SessionManager`, `BrowserControlAPI`, web server, policy profiles, and state storage where appropriate.
- Keep Browser Control as one unified engine.
- Do not create a second policy engine.
- Do not create a second terminal engine.
- Do not create a second workflow runtime.
- Do not create a second package registry unless it wraps the current registry.
- Do not bypass policy checks for convenience.
- Do not use raw filesystem paths for user-facing artifact references when data-home helpers exist.

State:

- Use SQLite state storage for durable product state unless data naturally belongs in existing JSON/package files.
- Use data home, not repo, for runtime data, secrets, reports, helper generation, and artifacts.
- Never delete user DBs as recovery.
- Quarantine corrupt DB files by moving:

```text
C:\Users\11\.browser-control\memory\memory.sqlite
C:\Users\11\.browser-control\memory\memory.sqlite-wal
C:\Users\11\.browser-control\memory\memory.sqlite-shm
```

into:

```text
C:\Users\11\.browser-control\reports\sqlite-recovery\<timestamp-or-id>\
```

and write/preserve `recovery-report.json`.

Security:

- Loopback-only by default for local APIs.
- Token required for privileged local APIs.
- Wrong/missing token must fail.
- Wrong Origin WebSocket must fail.
- Sensitive values must be redacted everywhere.
- Terminal/fs/browser actions must go through policy.
- Destructive actions must require exact confirmation.
- Remote providers must be opt-in and audited.
- Anti-detect/stealth must never become default.

UI:

- Keep mobile 375x812 usable.
- No horizontal overflow.
- No clipped panels.
- No buttons with unreadable text.
- Use semantic controls.
- Use real loading/empty/error states.
- Capture fresh screenshots after UI changes.

Desktop:

- Verify real UI, not only process existence.
- Screenshot must not be blank.
- Output under `reports/ui-verification/`, not `scripts/reports/`.
- Close desktop app and server child process after verification.
- Final check:

```powershell
Get-Process "Browser Control" -ErrorAction SilentlyContinue
```

==================================================
BASELINE CHECKS BEFORE MAJOR IMPLEMENTATION
==================================================

Before changing feature code, run or inspect:

```text
git status --short
npx biome check . --max-diagnostics=30
npm run typecheck
npm run web:typecheck
npm run test:state
```

Also check for stale processes:

```powershell
Get-Process "Browser Control" -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 7790 -ErrorAction SilentlyContinue
```

If port 7790 is in use, inspect owning process command line before stopping it:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId=<PID>" | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine
```

Do not kill unrelated user processes blindly.

==================================================
FINAL VERIFICATION GATES
==================================================

Run all applicable commands before claiming completion:

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

If your feature touches browser launch/profile/provider/live browser lifecycle, also run:

```text
npm run test:browser-features
```

If it fails with the known Windows profile lock issue, fix it if your changes touch that code. If unrelated, document exact failure as pre-existing.

Required artifacts after UI/dashboard/desktop changes:

```text
reports/ui-verification/sidebar-desktop.png
reports/ui-verification/sidebar-mobile.png
reports/ui-verification/sidebar-after-hard-refresh.png
reports/ui-verification/desktop-sidebar.png
reports/ui-verification/screenshot-manifest.json
```

Required runtime checks:

1. `npx ts-node scratch/count_tools.ts` prints tool count under 100 and no malformed DB warning.
2. `npm run web:serve` startup is checked for the real malformed DB warning.
3. Every server/process started by the task is stopped.
4. No orphan `Browser Control.exe` processes started by this task remain.
5. Port 7790 is clear unless a pre-existing user server is intentionally running and documented.
6. Screenshot files exist, are nonempty, and visually show expected UI.

==================================================
TRACKER UPDATE REQUIREMENT
==================================================

Update `premium-completion-tracker.md` truthfully at the end.

It must include:

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
19. Feature backlog status.
20. Remaining blockers.
21. Known non-blocking issues.

Do not mark an item complete unless evidence exists from the current session or explicitly cited previous verified artifact still applies.

==================================================
STRICT COMPLETION RULE
==================================================

Do not claim complete unless all are true:

1. Biome exits 0.
2. Typecheck exits 0.
3. Web typecheck exits 0.
4. Required tests pass.
5. Build commands pass.
6. Package dry-run passes.
7. Web screenshots exist and are nonempty if UI changed.
8. Mobile screenshot at 375x812 is usable and not horizontally clipped if UI changed.
9. Desktop UI screenshot exists and is nonblank if desktop/web shell changed.
10. Runtime `web:serve` malformed DB status is fixed or honestly documented.
11. `premium-completion-tracker.md` is truthful.
12. No started Browser Control desktop processes are left running.
13. No started web servers, daemons, browsers, or PTYs are left running unless intentionally left and documented.
14. Final verification gates pass or have exact documented blockers.
15. Feature backlog item(s) requested for this session are actually implemented and product-verified, not only scaffolded.

If any item is not verified, result is Partial or Blocked, not Complete.

==================================================
FINAL RESPONSE FORMAT
==================================================

When finished, respond with:

1. Status: Complete / Partial / Blocked.
2. Feature scope completed.
3. Files changed.
4. Commands run and results.
5. Screenshot/artifact paths.
6. Product verification evidence.
7. Security/policy verification evidence.
8. Process cleanup result.
9. Remaining blockers, if any.
10. Strict completion audit matching this file.

Do not say "production-ready", "fully complete", or "no blockers remain" unless the strict completion rule is fully satisfied.

