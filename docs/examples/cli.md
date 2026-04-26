# CLI Example

PowerShell:

```powershell
bc setup --non-interactive --profile balanced
bc doctor
bc status --json
bc config get policyProfile
bc session create docs-demo --policy balanced
bc term exec "node --version" --json
bc fs ls . --json
```

Source checkout:

```powershell
npm run cli -- setup --non-interactive --profile balanced
npm run cli -- doctor
npm run cli -- status --json
```
