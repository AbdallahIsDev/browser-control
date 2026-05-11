# Contributing to Browser Control

Thank you for your interest in contributing!

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USER/browser-control.git`
3. **Install** dependencies: `npm install`
4. **Create a branch**: `git checkout -b feature/my-feature`

## Development Setup

```powershell
npm install
npm run typecheck
npm run build
npm link    # Makes `bc` available globally for testing
```

## Code Quality Gates

Before submitting a PR, ensure these pass:

```powershell
npm run typecheck        # TypeScript type checking (zero errors)
npm test                 # Unit tests
npm run test:ci          # Full CI suite (unit + E2E + compatibility)
npm run test:mcp         # MCP-specific tests
npm run test:web         # Web frontend tests
```

## Code Style

- **Language:** TypeScript (strict mode)
- **Formatting:** Biome (`npm run format`)
- **Linting:** Biome (`npm run lint`)
- **Imports:** Use `@/` path alias for `src/` imports
- **File naming:** `snake_case.ts` for modules, `camelCase.ts` for utilities
- **No circular imports** between top-level directories

## Architecture Guidelines

- New browser features go in `src/browser/`
- New terminal features go in `src/terminal/`
- New filesystem features go in `src/filesystem/`
- New MCP tools are registered in `src/mcp/tools/`
- Policy decisions are centralized in `src/policy/`
- All public actions return `ActionResult` from `src/shared/result.ts`

## Commit Messages

Follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code restructuring
- `test:` Adding or updating tests
- `chore:` Build, CI, dependencies

## Pull Request Process

1. Open a PR against the `main` branch
2. Describe what your change does and why
3. CI must pass all checks
4. At least one maintainer review required
5. See [docs/release-checklist.md](docs/release-checklist.md) for release gates

## Reporting Bugs

- Use GitHub Issues
- Include: Browser Control version, Node.js version, OS, steps to reproduce, expected vs actual behavior, relevant logs/output
- Run `bc debug health` and include the output if relevant

## Feature Requests

- Search existing issues first
- Describe the use case clearly
- If you're implementing it, mention it in the issue

## Questions?

Open a Discussion on GitHub or reach out via the issue tracker.
