# Combined Workflow Example

PowerShell:

```powershell
bc session create combined-demo --policy balanced --cwd .
bc service register app --port 3000 --protocol http --path /
bc service resolve app --json
bc term exec "node --version" --json
bc fs ls . --json
bc browser provider use local
bc browser status
```

If a local dev server is running on port `3000`, open it:

```powershell
bc open http://127.0.0.1:3000/
bc snapshot
```

If no browser is available, the service, terminal, filesystem, and status steps still provide useful local automation coverage.
