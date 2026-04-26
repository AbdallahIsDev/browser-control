# Browser

Browser Control supports Chromium/CDP browser automation.

## Modes

- `managed`: Browser Control launches/owns an automation browser profile.
- `attach`: Browser Control connects to an existing CDP endpoint.

Config:

```powershell
bc config set browserMode managed
bc config set chromeDebugPort 9222
bc config set chromeBindAddress 127.0.0.1
bc config set browserDebugUrl http://127.0.0.1:9222
bc config set chromePath "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

Commands:

```powershell
bc browser launch --port 9222 --profile default
bc browser attach --port 9222
bc browser status
bc open https://example.com
bc snapshot
```

## Accessibility Refs

`bc snapshot` returns a semantic accessibility snapshot. Interactive elements get refs such as `@e1`.

Use refs for stable actions:

```powershell
bc click "@e3"
bc fill "@e4" "hello"
```

## Profiles and Auth State

Profiles live under the Browser Control data home. Commands:

```powershell
bc browser profile list
bc browser profile create demo --type named
bc browser profile use demo
bc browser auth export .\auth.json --stored --profile demo
bc browser auth import .\auth.json --stored
```

Auth snapshots contain cookies/storage. Treat them as sensitive.

## CDP Port 9222

Default CDP port is `9222`. Override with:

```powershell
bc config set chromeDebugPort 9223
```

or:

```powershell
$env:BROWSER_DEBUG_PORT = "9223"
```

In a source checkout, `launch_browser.bat 9222 127.0.0.1` still exists for Windows local-only CDP launch and writes CDP metadata under `.interop/chrome-debug.json`.

## Degraded Mode

When Chrome/CDP is unavailable:

- `bc doctor` reports browser warnings or degraded state.
- browser commands can fail.
- terminal, filesystem, config, status, service registry, provider registry, and many debug commands still work.

## Windows and WSL

Windows launcher from a source checkout:

```powershell
.\launch_browser.bat 9222 127.0.0.1
.\launch_browser.bat 9222 0.0.0.0
```

The launcher writes CDP endpoint metadata to:

```text
~/.browser-control/.interop/chrome-debug.json
```

Binding CDP to `0.0.0.0` can expose the unauthenticated debug endpoint beyond loopback. Use explicit loopback (`127.0.0.1`) unless WSL or remote access requires another address, and rely on firewall/network controls when using a non-loopback bind.

## Remote Providers

Provider commands:

```powershell
bc browser provider list
bc browser provider use local
bc browser provider add remote --type custom --endpoint https://browser.example.test
bc browser provider add bbase --type browserless --endpoint https://production-sfo.browserless.io --api-key=$env:BROWSERLESS_API_KEY
```

Built-ins: `local`, `custom`, `browserless`. Provider tokens are sensitive and redacted in config output, but remain local secrets.
