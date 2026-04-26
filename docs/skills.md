# Skills

Skills package domain-specific browser automation behind manifests and actions.

CLI:

```powershell
bc skill list
bc skill actions <name>
bc skill health <name>
bc skill validate <name-or-path>
bc skill install <path>
bc skill remove <name>
```

Broker endpoint, when daemon/broker is running:

```powershell
curl http://127.0.0.1:7788/api/v1/skills
```

If `BROKER_API_KEY` or `BROKER_SECRET` is set, broker API calls need the configured auth header expected by the broker.

Skill runtime files live under the Browser Control data home unless a project registers local skills explicitly. Policy profiles constrain what a skill can do.
