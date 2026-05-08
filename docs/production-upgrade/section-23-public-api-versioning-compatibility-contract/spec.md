# Section 23: Public API, Versioning, and Compatibility Contract

## Purpose

Once users and agents depend on Browser Control, accidental breaking changes become product bugs. This section defines the public compatibility contract for CLI, TypeScript API, MCP tools, config, and persisted state.

## Scope

- Identify public surfaces: CLI commands/flags, TypeScript exports, MCP tools/schemas, config keys, environment variables, data directories, persisted registry formats.
- Define semantic versioning rules.
- Add schema snapshots for MCP tools and key JSON outputs.
- Add compatibility tests that fail on accidental breaking changes.
- Define deprecation policy and migration notes.
- Document what is stable vs experimental.

## Non-Goals

- Do not freeze every internal module.
- Do not promise compatibility for undocumented private files.
- Do not block necessary breaking changes; require explicit versioned migration instead.

## Public Surface Inventory

Required inventory:

- CLI commands and flags
- `ActionResult` shape
- TypeScript `createBrowserControl()` API
- MCP tool names, descriptions, input schemas, output shape expectations
- config keys and env var aliases
- provider/service registry file formats
- debug bundle format
- terminal resume serialized format

## Compatibility Tests

Add tests for:

- MCP tool registry snapshot
- CLI help command inventory
- TypeScript export smoke import
- config key inventory
- `ActionResult` core fields

Snapshots should be intentional. If a public surface changes, the developer must update the snapshot and include a migration/deprecation note.

## Versioning Rules

- Patch: bug fixes, docs, internal refactors, compatible additions
- Minor: new tools/commands/options, compatible output additions
- Major: removed/renamed public commands, breaking schema changes, incompatible persisted-state changes

## Documentation

Create or update:

- `docs/api.md`
- `docs/cli.md`
- `docs/mcp.md`
- `docs/compatibility.md`
- release checklist references

## Verification

- `npm run typecheck`
- public surface snapshot tests
- package import smoke tests
- MCP schema snapshot tests

## Success Criteria

- users know what is stable
- agents can rely on MCP/CLI/API schemas
- accidental breaking changes are caught by tests
- future releases have a clear migration path
