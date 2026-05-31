# Automation Packages

Automation Packages are reusable browser workflow bundles.

Use them for repeatable browser tasks that need replay, evidence, repair, and permission review.

CLI:

```powershell
bc package install <source>
bc package record start --name="Login smoke" --domain=example.com
bc package record action terminal-exec --params='{"command":"echo smoke"}'
bc package record stop
bc package draft <recording-id>
bc package materialize <recording-id> --overwrite
bc package list
bc package info <name>
bc package update <name> [source]
bc package remove <name>
bc package run <name> [workflow]
bc package eval <name>
bc package grant <name> <permission>
bc package review <name> approved --by=<reviewer> --reason=<reason>
bc package review-history <name>
bc package eval-history [name]
bc package sign <source> --private-key=<pem> --signer=<name>
```

Recording-to-package flow:

```powershell
bc package record start --name="Login smoke" --domain=example.com --json
bc browser task run --steps='<json>' --json
bc package record action terminal-exec --params='{"command":"echo smoke"}' --json
bc package record stop --json
bc package draft <recording-id> --json
bc package materialize <recording-id> --overwrite --json

# Dashboard/API recording endpoints are also available:
# POST /api/recordings/start
# POST /api/recordings/stop
# POST /api/recordings/<id>/materialize {"install":true}
```

Legacy internal commands may still use `skill` names for compatibility. Public docs and UI should say Automation Package, Package, or Workflow.

If an installed package declares exactly one workflow, `bc package run <name>` selects it automatically. Multi-workflow packages require an explicit workflow id, workflow name, or manifest path.

Package runtime files live under Browser Control data home:

- `packages/installed` stores installed, reviewed packages.
- `packages/drafts` stores materialized drafts created from recordings.
- `packages/eval-history.json` stores recent eval results.
- `packages/reviews` stores trust review history.

Policy profiles constrain browser, terminal, filesystem, network, and helper actions. Trust metadata is accepted in manifests through the `trust` object, while unknown manifest keys still fail validation.
