# Automation Packages

Automation Packages are reusable browser workflow bundles.

Use them for repeatable browser tasks that need replay, evidence, repair, and permission review.

CLI:

```powershell
bc package list
bc package info <name>
bc package run <name>
bc package eval <name>
bc package grant <name> <permission>
```

Legacy internal commands may still use `skill` names for compatibility. Public docs and UI should say Automation Package, Package, or Workflow.

Package runtime files live under Browser Control data home. Policy profiles constrain browser, terminal, filesystem, network, and helper actions.
