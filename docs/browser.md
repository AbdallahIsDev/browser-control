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

## Auth State And Profiles

Attaching to a real browser exposes existing tabs, cookies, logged-in accounts, downloads, and local/session storage to automation. Managed browser profiles reduce accidental exposure but still persist automation auth state under `BROWSER_CONTROL_HOME`.

Auth export/import is high-risk because snapshots can contain cookies and storage values that act like credentials. Keep `BROWSER_CONTROL_HOME` private, do not commit auth snapshots, and use `POLICY_PROFILE=safe` when working with untrusted agents or unknown pages.

Remote provider endpoints can include tokens. Browser Control redacts provider tokens in displayed metadata and errors, but `.env` files and provider registry files remain sensitive local configuration.
