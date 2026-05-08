# Section 21: End-to-End Reliability and Golden Workflows

## Purpose

Unit tests prove pieces. A premium automation product needs real workflows that prove the pieces work together.

This section creates golden end-to-end workflows and reliability checks across browser, terminal, filesystem, MCP, sessions, observability, and recovery.

## Scope

- Define a small set of deterministic local apps/fixtures for browser automation.
- Add E2E workflows that combine terminal, filesystem, browser, services, sessions, MCP, and debug recovery.
- Measure pass/fail, timing, retry behavior, and cleanup.
- Add examples that double as tests where possible.
- Keep remote network dependency out of required tests.

## Non-Goals

- Do not benchmark public websites as required CI dependencies.
- Do not create a massive benchmark suite that slows every local run.
- Do not hide flaky results; classify and fix or quarantine them.

## Golden Workflows

Minimum workflows:

1. **Local web app workflow**
   - start a local test server from terminal path
   - register a stable service URL
   - open the app in browser path
   - interact through a11y refs
   - assert DOM/result state
   - clean up the server

2. **MCP workflow**
   - start MCP server over stdio
   - call browser/terminal/fs/session/debug tools
   - verify JSON-RPC cleanliness
   - verify policy denial surfaces cleanly

3. **Failure recovery workflow**
   - trigger a controlled browser or fs failure
   - verify `ActionResult` includes debug bundle and recovery guidance
   - load the debug bundle safely
   - verify secrets are redacted

4. **Terminal resume workflow**
   - open terminal session
   - write identifiable output
   - serialize/restart or simulate restore
   - verify restored metadata and buffer continuity

5. **Provider/service workflow**
   - configure local provider and a custom/mock provider where possible
   - verify provider selection does not change higher-level action shape

## Reliability Reporting

Create a local report format with:

- workflow name
- pass/fail
- duration
- retries
- cleanup result
- debug bundle id on failure

## Verification

- `npm run typecheck`
- focused E2E command
- Windows cleanup scan after E2E
- MCP stdio smoke test
- generated reliability report inspection

## Success Criteria

- the product has a small, repeatable proof suite
- failures produce useful evidence
- cleanup is reliable on Windows
- examples and tests reinforce each other
