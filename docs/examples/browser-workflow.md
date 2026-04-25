# Browser Workflow Example

PowerShell:

```powershell
bc browser launch --port 9222 --profile default
bc open https://example.com
bc snapshot
bc screenshot --output .\example.png
bc browser status
```

Attach to an existing CDP endpoint:

```powershell
bc browser attach --cdp-url http://127.0.0.1:9222
bc open https://example.com
bc snapshot
```

Use refs from `snapshot`:

```powershell
bc click "@e3"
bc fill "@e4" "hello"
```

Browser commands require Chrome/CDP or a configured provider.
