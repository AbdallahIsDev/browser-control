# Section 22: Documentation and Product Onboarding Cleanup

## Purpose

The docs should make Browser Control feel coherent, not like a pile of implementation notes. A premium product needs clear docs for users, operators, agents, and contributors.

This section reorganizes and cleans documentation after the product hardening sections define the real behavior.

## Scope

- Organize docs into user-facing, operator-facing, API/MCP, security, examples, troubleshooting, and contributor docs.
- Remove stale or contradictory docs.
- Add a clear support matrix and limitations page.
- Add quickstarts for CLI, MCP, TypeScript API, browser workflows, terminal workflows, and combined workflows.
- Ensure docs explain degraded browser mode, Windows behavior, data locations, config, and cleanup.
- Keep production-upgrade specs separate from user docs.

## Non-Goals

- Do not write marketing fluff instead of accurate docs.
- Do not document unsupported native desktop automation as supported.
- Do not duplicate the same instructions across many files without a source of truth.

## Target Docs

Suggested public docs:

- `README.md`: concise product overview and quickstart
- `docs/getting-started.md`: install and first workflow
- `docs/cli.md`: command reference
- `docs/api.md`: TypeScript API reference
- `docs/mcp.md`: MCP setup and tools
- `docs/browser.md`: browser automation and profiles
- `docs/terminal.md`: terminal/filesystem automation
- `docs/security.md`: trust boundaries and safe usage
- `docs/troubleshooting.md`: common failures and fixes
- `docs/examples/`: runnable examples tied to Section 21

## Documentation Rules

- Every command example should be copy-pasteable.
- JSON examples should be valid JSON.
- Windows-specific instructions should use PowerShell when appropriate.
- Risky commands should explain what they touch.
- Claims must match actual tests or clearly state limitations.

## Verification

- docs link check where practical
- command snippets smoke-tested for core quickstarts
- `bc --help` and docs command list compared for drift
- MCP tool list compared to docs

## Success Criteria

- a new user can understand install, setup, and first automation in minutes
- agents can find MCP/API usage without reading source
- limitations are explicit
- docs no longer conflict with each other
