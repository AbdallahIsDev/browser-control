# Policy

Browser Control uses policy profiles to control local automation risk.

Built-ins:

- `safe`: denies high and critical risk actions.
- `balanced`: default; requires confirmation for high and critical risk actions.
- `trusted`: audits high risk actions and requires confirmation for critical risk actions.

Set profile:

```powershell
bc config set policyProfile balanced
```

Inspect:

```powershell
bc policy list
bc policy inspect balanced
bc status
```

Environment variables override user config:

```powershell
$env:POLICY_PROFILE = "safe"
```

Policy affects command, filesystem, browser, service, terminal, and debug actions. Read [Security](security.md) before connecting Browser Control to untrusted agents.
