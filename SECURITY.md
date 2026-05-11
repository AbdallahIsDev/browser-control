# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Browser Control, please report it privately.

**Do not open a public GitHub issue.**

Email: security@browser-control.dev (or open a private security advisory on GitHub)

We aim to acknowledge reports within 48 hours and provide an initial assessment within 5 business days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x (main) | ✅ Active development |

Browser Control is currently **pre-release software** under active development. Security fixes will be applied to the `main` branch.

## Security Model

Browser Control runs with the same user account authority as the operator. It is local-machine automation — treat it like a tool that can use the same permissions as your user account.

### Trust Boundaries

- CLI/API/MCP caller → Browser Control runtime
- Browser Control runtime → local shell, filesystem, browser
- Browser Control runtime → remote browser providers
- Browser pages and retrieved content → AI agent instructions
- Debug/log evidence → local storage

### Policy Profiles

Three built-in profiles gate every action by risk level:

- **`safe`**: Denies high and critical risk actions
- **`balanced`** (default): Requires confirmation for high and critical risk actions
- **`trusted`**: Audits high risk, confirms critical risk

Set profile: `bc config set policyProfile safe`

Full policy documentation: [docs/policy.md](docs/policy.md)

### MCP Security

MCP tools expose local automation to AI agents. Only connect trusted clients.

Recommendations:
- Use `safe` or `balanced` policy for agent-facing sessions
- Scope working directories to project boundaries
- Avoid storing provider/API tokens in prompts
- Review terminal and filesystem actions before granting broad agent autonomy

Full MCP security: [docs/mcp.md](docs/mcp.md)

### Secrets Handling

The following keys are redacted from config output:
- `BROWSERLESS_API_KEY`
- `CAPTCHA_API_KEY`
- `OPENROUTER_API_KEY`

This is output redaction only — not a global secrecy guarantee. Logs, debug bundles, terminal output, and screenshots may still contain private data.

### Safe Usage Recommendations

- Use a dedicated browser profile for automation (`BROWSER_LAUNCH_PROFILE=isolated`)
- Prefer loopback CDP bind addresses unless WSL/remote access requires more
- Use separate `BROWSER_CONTROL_HOME` values for experiments
- Keep destructive filesystem actions inside a project workspace
- Run `bc doctor` before handing control to an agent

Full security documentation: [docs/security.md](docs/security.md)
