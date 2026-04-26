# Section 18 Implementation Checklist

## Section

- Section: `18 - Security, Privacy, and Policy Hardening`
- Spec: `spec.md`
- Status: `implemented on branch, pending orchestrator review`

## Files Read

- [x] `README.md`
- [ ] `docs/specs/2026-04-20-browser-control-v1-unified-automation-roadmap.md` (missing from this worktree)
- [x] `docs/production-upgrade/README.md`
- [x] `docs/production-upgrade/STATUS.md`
- [x] `docs/production-upgrade/section-18-security-privacy-policy-hardening/spec.md`
- [x] Policy, routing, session, browser/auth, terminal/fs, daemon/broker, MCP, observability, provider/service, operator, and docs files reviewed

## Baseline Verification

- [x] `git status --short --branch`
- [x] `npm run typecheck`
- [x] `npm audit --audit-level=high`
- [x] Focused baseline security tests

## Policy Enforcement Review

- [x] Review `execution_router.ts`, `policy_engine.ts`, `policy_profiles.ts`, `policy_audit.ts`, `session_manager.ts`
- [x] Review action wrappers for terminal, filesystem, browser auth/profile/provider/service mutation paths
- [x] Review MCP tools for sensitive read, debug evidence, mutation, daemon/provider/service authority
- [x] Fix any public risky action that bypasses existing policy/session/action model
- [x] Add/update policy regression tests

## Secrets And Redaction Review

- [x] Review `observability/redaction.ts`, `logger.ts`, `config.ts`, `terminal_serialize.ts`
- [x] Confirm URL credentials and sensitive query params redact inside arbitrary strings
- [x] Confirm auth/cookie headers and object secret keys redact recursively
- [x] Confirm terminal env serialization catches token/key/password/auth/cookie/private-key patterns
- [x] Confirm debug bundle error strings/stacks are redacted
- [x] Run high-confidence local secret scan for GitHub/OpenAI/AWS/private-key patterns
- [x] Add/update redaction regression tests

## Broker And Daemon Review

- [x] Review `broker_server.ts`, `daemon.ts`, `paths.ts`, `daemon_cleanup.ts`, `daemon_launch.ts`
- [x] Confirm config mutation requires broker auth and `config_set` policy evaluation
- [x] Confirm unauthenticated endpoints are intentional and non-mutating
- [x] Confirm bind address and API key behavior are documented
- [x] Confirm error responses do not leak secrets
- [x] Confirm cleanup targets only Browser Control-owned processes

## MCP Review

- [x] Review MCP registry and browser/terminal/fs/session/debug/provider/service/status tools
- [x] Confirm debug evidence tools evaluate policy before returning sensitive evidence
- [x] Confirm MCP stdout/stderr trust boundary is documented
- [x] Add/update MCP policy regression tests

## Browser Auth And Provider Review

- [x] Review `browser_auth_state.ts`, `browser_connection.ts`, `providers/browserless.ts`, `providers/custom.ts`, `providers/registry.ts`, `browser_actions.ts`
- [x] Confirm auth export/import are high-risk and policy-governed
- [x] Confirm provider tokens are redacted in errors, metadata, persisted registry views, and MCP results
- [x] Confirm provider registry save failures do not report false success
- [x] Add/update provider/auth regression tests, including stored CLI auth import/export policy denial

## Terminal And Filesystem Review

- [x] Review `terminal_actions.ts`, `terminal_exec.ts`, `terminal_session.ts`, `terminal_serialize.ts`, `fs_actions.ts`, `fs_operations.ts`
- [x] Confirm arbitrary shell execution is classified correctly
- [x] Confirm recursive delete is high/critical risk and cannot bypass policy
- [x] Confirm file writes/moves/deletes are classified correctly
- [x] Confirm debug/serialization paths do not persist known env secrets unredacted
- [x] Add/update terminal/fs regression tests

## Dependency Audit Review

- [x] Run `npm audit --audit-level=high`
- [x] Review moderate findings and decide fix/defer
- [x] Document high/critical findings, or absence of high/critical findings

## Documentation

- [x] Create `docs/security.md`
- [x] Add README security pointer
- [x] Update MCP safety notes
- [x] Update browser auth/profile warning
- [x] Update terminal authority warning
- [x] Update `.env.example` if broker/security env docs are missing
- [x] Update `docs/production-upgrade/STATUS.md` only after implementation and verification

## Final Verification

- [x] `npm run typecheck`
- [x] Focused security regression tests including `cli_auth_policy.test.ts`
- [x] `npm audit --audit-level=high`
- [x] `npm test` attempted (timed out after 368 seconds in this environment)
- [x] Windows process cleanup sanity scan (one Section 18 daemon cleanup; unrelated Section 23 daemon left alone)
- [x] Current git status captured

## Orchestrator-Only Completion

- [ ] Section implementation reviewed and accepted by orchestrator
- [ ] Changes committed and pushed by orchestrator with final commit message
