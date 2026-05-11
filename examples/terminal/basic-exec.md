# Terminal Basic Exec

Runs one command through the policy-governed terminal path.

## Commands

```powershell
bc term exec "node --version" --json
```

## Expected Output

JSON contains:

```json
{
  "success": true,
  "path": "command",
  "data": {
    "exitCode": 0,
    "stdout": "v..."
  }
}
```

## Common Issues

If the terminal path is unavailable:

```powershell
bc doctor
```
