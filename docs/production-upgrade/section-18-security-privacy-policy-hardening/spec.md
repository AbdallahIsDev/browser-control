# Section 18: Security, Privacy, and Policy Hardening

## Purpose

Browser Control can control browsers, terminals, files, auth state, and MCP tools. That is powerful enough to require a serious security pass before calling the product premium or broadly reliable.

This section performs a structured security hardening review and fixes concrete risks.

## Scope

- Create a threat model for local CLI, TypeScript API, daemon/broker HTTP API, MCP stdio tools, browser auth state, terminal execution, filesystem operations, providers, services, and debug bundles.
- Review all policy-sensitive paths for bypasses.
- Review secret handling across config, logs, debug bundles, provider URLs, auth snapshots, env serialization, MCP results, and docs.
- Review broker auth, config mutation endpoints, local network exposure, and allowed host/domain behavior.
- Review dependency audit output and pin/remediate actionable vulnerabilities.
- Add security regression tests for every real issue found.
- Add security documentation for supported trust boundaries and safe deployment.

## Non-Goals

- Do not add enterprise RBAC or cloud identity in this section.
- Do not block local developer workflows with unusable prompts.
- Do not claim sandboxing that the product does not actually enforce.
- Do not hide security limitations; document them plainly.

## Required Review Areas

### Policy Enforcement

- Browser actions
- terminal actions
- filesystem actions
- service/provider management
- MCP tools
- debug evidence export
- config mutation
- daemon lifecycle actions

Every action that can disclose sensitive data, mutate local state, execute code, or connect to remote services must have a clear risk classification and policy path.

### Secrets and Sensitive Data

Review and test redaction for:

- API keys
- bearer tokens
- cookies
- auth headers
- Browserless/provider tokens
- URL username/password credentials
- query parameters such as `token`, `api_key`, `secret`, `password`, `key`
- terminal env serialization
- debug bundles and logs

### Local Network and Daemon Exposure

- broker bind address
- auth key behavior
- unauthenticated endpoint behavior
- rate limiting
- config writes
- CORS/domain restrictions if applicable

### Filesystem and Terminal Authority

- recursive delete
- writes outside allowed roots
- shell execution risk classification
- daemon cleanup process targeting
- Windows-specific hidden process behavior

## Security Documentation

Create or update:

- `docs/security.md`
- security section in `README.md`
- MCP safety notes
- provider credential handling notes
- auth snapshot risk notes

## Verification

- `npm run typecheck`
- focused security regression tests
- `npm audit --audit-level=high`
- secret scan using local scripts or a documented dependency if adopted
- MCP debug/tool policy tests
- broker auth/config mutation tests

## Success Criteria

- threat model exists and is actionable
- no known high-severity policy bypass remains
- secrets are not persisted or returned unredacted in known paths
- broker/MCP/debug evidence exports are governed by policy
- security docs explain safe and unsafe deployment modes
