# Combined Dev Server Workflow

Uses terminal, service registry, and browser surfaces together.

## Commands

```powershell
bc term exec "node --version" --json
bc service register local-app --port 3000 --path /
bc service resolve local-app
bc open bc://local-app
bc snapshot
```

## Expected Output

- Terminal command exits with code `0`.
- Service registry resolves `bc://local-app` to a loopback URL.
- Browser opens the resolved local app URL.

## Common Issues

If no app is listening on port `3000`, the browser page may show a connection error. Start the app first or use a live local port.
