# Skills

Skills package domain-specific browser automation behind a stable manifest and execution interface.

The broker can list skills:

```bash
curl http://127.0.0.1:7788/api/v1/skills
```

Skill runtime files live under the Browser Control data home unless a project registers local skills explicitly.

Use policy profiles to constrain which commands and domains a skill can use.
