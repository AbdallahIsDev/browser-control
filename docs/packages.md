# Automation Packages

Automation Packages are reusable browser workflow bundles.

Use them for repeatable browser tasks that need replay, evidence, repair, and permission review.

CLI:

```powershell
bc package install <source>
bc package list
bc package info <name>
bc package update <name> [source]
bc package remove <name>
bc package run <name> <workflow>
bc package eval <name>
bc package grant <name> <permission>
bc package review <name> approved --by=<reviewer> --reason=<reason>
bc package review-history <name>
bc package eval-history [name]
bc package sign <source> --private-key=<pem> --signer=<name>
```

Recording-to-package flow:

```powershell
bc browser task run --steps='<json>' --json
# or use dashboard/API recording endpoints
# POST /api/recordings/start
# POST /api/recordings/stop
# POST /api/recordings/<id>/materialize {"install":true}
```

Legacy internal commands may still use `skill` names for compatibility. Public docs and UI should say Automation Package, Package, or Workflow.

Package runtime files live under Browser Control data home:

- `packages/installed` stores installed, reviewed packages.
- `packages/drafts` stores materialized drafts created from recordings.
- `packages/eval-history.json` stores recent eval results.
- `packages/reviews` stores trust review history.

Policy profiles constrain browser, terminal, filesystem, network, and helper actions. Trust metadata is accepted in manifests through the `trust` object, while unknown manifest keys still fail validation.
