# Policy

Browser Control uses policy profiles to control risk:

- `safe`: most restrictive.
- `balanced`: default operator profile.
- `trusted`: broadest local automation profile.

Set the active profile:

```bash
bc config set policyProfile balanced
```

Environment variables still override user config, so `POLICY_PROFILE=safe` wins over `~/.browser-control/config.json`.

Use `bc doctor` to validate policy configuration and `bc status` to see the effective profile.

