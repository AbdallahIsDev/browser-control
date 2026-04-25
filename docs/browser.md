# Browser

Browser Control supports two browser modes:

- `managed`: Browser Control launches or owns the automation browser profile.
- `attach`: Browser Control connects to an already running Chrome/CDP endpoint.

Common config keys:

```bash
bc config set browserMode managed
bc config set chromeDebugPort 9222
bc config set chromeBindAddress 127.0.0.1
bc config set browserDebugUrl http://127.0.0.1:9222
bc config set chromePath "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
```

Use `bc doctor` to check Chrome availability and CDP attachability. Missing Chrome or a closed CDP port is reported as degraded unless the selected workflow requires browser automation.
