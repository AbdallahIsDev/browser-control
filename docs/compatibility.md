# Compatibility Contract

Browser Control treats documented operator, agent, and package surfaces as product contracts. Compatibility snapshots live in `test-fixtures/public-surface/` and normal tests compare current behavior against them. Updating snapshots is intentional only.

## Stable Public Surfaces

Stable surfaces are covered by semantic versioning and compatibility tests:

- CLI command names, subcommand names, documented flags, and documented JSON output support from `bc --help`.
- TypeScript exports from `index.ts`.
- `createBrowserControl()` top-level object and namespaces: `browser`, `terminal`, `fs`, `session`, `service`, `provider`, `debug`, `config`, `status`, and `close`.
- `ActionResult` core fields: `success`, `path`, `sessionId`, `data`, `warning`, `error`, `auditId`, `policyDecision`, `risk`, `completedAt`, debug bundle fields, recovery guidance, and partial-debug marker.
- MCP tool names, categories, descriptions, input schemas, and output wrapper shape.
- Config keys and public environment variable aliases.
- Data home behavior: `~/.browser-control` by default, `BROWSER_CONTROL_HOME` override, and documented subdirectories/files.
- Persisted public formats for service registry, provider registry, debug bundles, and terminal resume/buffer records.

## Experimental Surfaces

Experimental surfaces may change in minor releases if documented and migrated:

- Provider-specific option bags.
- Debug bundle optional evidence sections and recovery-guidance text.
- Health-check detail names and diagnostic wording.
- Human-readable CLI formatting outside documented command/flag inventory.
- Built-in skill manifests and knowledge artifacts unless documented as stable elsewhere.

## Internal Surfaces

These are not compatibility promises:

- Private helper functions and unexported modules.
- Test helpers and fixtures outside `test-fixtures/public-surface/`.
- Runtime timestamps, process IDs, random IDs, absolute local paths, and machine-specific values.
- Log wording, stack traces, and best-effort diagnostic prose.

## Semantic Versioning

- Patch: bug fixes, docs, internal refactors, performance work, and compatible behavior fixes.
- Minor: compatible additions such as new commands, flags, MCP tools, optional fields, config keys, or TypeScript exports.
- Major: removals, renames, required-field changes, incompatible JSON/schema changes, changed persisted-state meaning, or behavior that breaks documented automation.

## Breaking Changes

Breaking changes include:

- Removing or renaming a CLI command, flag, MCP tool, TypeScript export, API method, config key, or env var.
- Changing a stable MCP input schema in a way that rejects previously valid calls.
- Removing or changing required `ActionResult` fields.
- Changing persisted registry/session/debug formats without migration.
- Changing documented JSON output so orchestrators cannot parse it.

## Compatible Additions

Compatible additions include:

- New optional CLI flags or JSON fields.
- New MCP tools or optional schema properties.
- New TypeScript exports.
- New config keys with safe defaults.
- New persisted fields that older readers can ignore.

## Deprecation Policy

Deprecations must be explicit before removal:

- Document deprecated surface, replacement, and earliest removal version.
- Keep deprecated behavior working until the next major release unless security requires faster removal.
- Add migration notes for every breaking change.
- Prefer warnings in human CLI output only; JSON output should remain machine-parseable.

## Snapshot Policy

Normal tests never update snapshots. To intentionally update the public contract:

```bash
npm run compat:test
npm run compat:update
npm run compat:test
```

Inspect snapshot diffs before committing. Snapshot files must not contain secrets, absolute local paths, timestamps, process IDs, random IDs, or user runtime data.

## Release Checklist

Before release:

- Run compatibility tests.
- Inspect public-surface snapshot diffs.
- Update docs for public changes.
- Add migration notes for breaking changes.
- Bump semver appropriately.
- Confirm sensitive values stay redacted in config, provider lists, terminal resume metadata, and debug bundles.
