# Packaging A Skill

Browser Control skills are local automation capabilities with a manifest and explicit actions.

## Minimal Flow

```powershell
bc skill validate .\my-skill
bc skill install .\my-skill
bc skill list
bc skill actions my-skill
```

## Expected Output

- `validate` reports manifest status.
- `install` copies the skill into the Browser Control data home.
- `actions` shows callable action metadata.

## Common Issues

If a skill is missing required metadata, fix the manifest and rerun `bc skill validate`.
