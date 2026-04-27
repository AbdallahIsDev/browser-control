# Windows User Install Manual Test - 2026-04-26

This file records the real-user Windows test pass run from a packed install, not from the development checkout.

## Test Environment

- OS: Windows
- Shell: PowerShell 7.6.1
- Node.js: 24.13.0
- Project checkout: `C:\Users\11\browser-control`
- User test project: `C:\Users\11\bc-user-test`
- Test data home: `C:\Users\11\bc-user-test\.browser-control`
- Install source: local package tarball from `npm pack`

Common setup:

```powershell
cd C:\Users\11\bc-user-test
$env:BROWSER_CONTROL_HOME="C:\Users\11\bc-user-test\.browser-control"
```

## Confirmed Passed

### Package Install And Help

Commands tested:

```powershell
cd C:\Users\11\browser-control
npm run build
npm pack
mkdir C:\Users\11\bc-user-test
cd C:\Users\11\bc-user-test
npm init -y
npm install C:\Users\11\browser-control\browser-control-1.0.0.tgz
npx bc --help
npm audit
```

Result:

- Package installed from tarball.
- `npx bc --help` printed CLI help.
- `npm audit` reported `found 0 vulnerabilities`.
- Help no longer loads Stagehand/LangChain dependency tree.
- Help no longer emits SQLite warning.

### Doctor, Status, Config, Provider

Commands tested:

```powershell
npx bc doctor
npx bc status
npx bc config list --json
npx bc browser provider list
npx bc browser provider use local
```

Result:

- Doctor runs.
- Config JSON is parseable.
- Provider list shows `local`, `custom`, and `browserless`.
- Local provider can be selected.
- `Daemon/Broker` warning is expected when daemon is not running.
- CDP warning is expected when no browser is listening on port `9222`.

### Filesystem Read And Stat

Commands tested:

```powershell
Set-Content C:\Users\11\bc-user-test\hello.txt "hello"
npx bc fs read C:\Users\11\bc-user-test\hello.txt
npx bc fs stat C:\Users\11\bc-user-test\hello.txt
```

Result:

- Read returned `hello`.
- Stat showed `exists: true`, `isFile: true`, and real file metadata.

Note:

- `bc fs write` was blocked by balanced policy as high risk. That is expected policy behavior, not a filesystem failure.

### Terminal Exec

Commands tested:

```powershell
npx bc term exec "echo hello"
npx bc term exec "node --version"
```

Result:

- Terminal command execution worked.
- Output returned `hello`.
- Node version returned `v24.13.0`.

### Browser Launch, Open, Snapshot, Screenshot

Commands tested:

```powershell
npx bc browser status
npx bc open https://example.com
npx bc snapshot --json
npx bc screenshot --output C:\Users\11\bc-user-test\shot.png
Test-Path C:\Users\11\bc-user-test\shot.png
```

Result:

- Stale browser state is detected as `disconnected` when Chrome is closed.
- `bc open` launches managed Chrome when needed.
- `bc open` reconnects to an already running managed Chrome when available.
- Snapshot returns accessibility data for `https://example.com/`.
- Screenshot writes a PNG file.

### Session And Browser Actions

Commands tested:

```powershell
npx bc session list
npx bc session create test-session
npx bc session use test-session
npx bc session status
npx bc open https://example.com
npx bc tab list
npx bc snapshot
npx bc click "Learn more"
Start-Sleep -Seconds 2
npx bc tab list
npx bc screenshot --output C:\Users\11\bc-user-test\iana-page.png
Test-Path C:\Users\11\bc-user-test\iana-page.png
npx bc close
```

Result:

- Session create/use/status worked.
- Browser opened `https://example.com/`.
- `tab list` returned page title `Example Domain`.
- Click on `Learn more` navigated to `https://www.iana.org/help/example-domains`.
- `tab list` returned page title `Example Domains`.
- Screenshot of the IANA page was saved.
- Browser tab close worked.

### Daemon Lifecycle

Commands tested:

```powershell
npx bc daemon status
npx bc daemon start
Start-Sleep -Seconds 3
npx bc daemon status
npx bc status
npx bc daemon health
npx bc daemon stop
Start-Sleep -Seconds 2
npx bc daemon status
```

Result:

- Daemon starts and writes a PID.
- Status reports daemon running.
- Broker is reachable at `http://127.0.0.1:7788`.
- Daemon health returns structured checks.
- Daemon stops and status returns not running.

Follow-up fix added:

- `daemon start` had a long silent readiness wait that felt stuck when commands were pasted in a batch. Startup probing is now shorter so the command returns faster and queued commands continue.

### Wikipedia Browser Test

Status:

- User confirmed the Wikipedia browser test completed successfully.

### Stable Local Services

Commands tested:

```powershell
mkdir C:\Users\11\bc-user-test\site -Force
Set-Content C:\Users\11\bc-user-test\site\index.html "<h1>Browser Control Service Test</h1><p>Hello from bc service.</p>"
$server = Start-Process node -ArgumentList "-e `"require('http').createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(require('fs').readFileSync('C:/Users/11/bc-user-test/site/index.html'))}).listen(3456,'127.0.0.1')`"" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
npx bc service register testsite --port 3456 --path /
npx bc service list
npx bc service resolve testsite
npx bc open bc://testsite
npx bc snapshot
npx bc screenshot --output C:\Users\11\bc-user-test\service-test.png
Test-Path C:\Users\11\bc-user-test\service-test.png
npx bc service remove testsite
Stop-Process -Id $server.Id -Force
npx bc service list
```

Result:

- Manual service registration succeeded.
- `service list` showed `testsite`.
- `service resolve testsite` returned `http://127.0.0.1:3456`.
- `bc open bc://testsite` resolved and opened `http://127.0.0.1:3456/`.
- Snapshot included heading `Browser Control Service Test`.
- Screenshot saved to `service-test.png`.
- Cleanup removed the service and stopped the test server.
- `service list` returned `[]` after cleanup.

### Stable Local Service Auto-Detect

Commands tested:

```powershell
mkdir C:\Users\11\bc-user-test\vite-detect -Force
@"
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4567
  }
})
"@ | Set-Content C:\Users\11\bc-user-test\vite-detect\vite.config.js

$viteServer = Start-Process node -ArgumentList "-e `"require('http').createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Detected Vite Service</h1><p>Port 4567</p>')}).listen(4567,'127.0.0.1')`"" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
npx bc service register viteapp --detect --cwd C:\Users\11\bc-user-test\vite-detect
npx bc service list
npx bc service resolve viteapp
npx bc open bc://viteapp
npx bc snapshot
npx bc screenshot --output C:\Users\11\bc-user-test\vite-detect.png
Test-Path C:\Users\11\bc-user-test\vite-detect.png
```

Result:

- `--detect --cwd` registered `viteapp` without passing `--port`.
- Detected port was `4567` from `vite.config.js`.
- `service resolve viteapp` returned `http://127.0.0.1:4567`.
- `bc open bc://viteapp` resolved and opened `http://127.0.0.1:4567/`.
- Snapshot included heading `Detected Vite Service`.
- Browser showed `Detected Vite Service` and `Port 4567`.
- Screenshot saved to `vite-detect.png`.

### Browser Profiles And Profile Switching

Commands tested:

```powershell
npx bc browser profile list
npx bc browser profile create manual-profile
npx bc browser profile list
npx bc browser profile use manual-profile
npx bc browser launch --profile=manual-profile
npx bc open https://example.com
npx bc browser status
npx bc screenshot --output C:\Users\11\bc-user-test\manual-profile-example.png
Test-Path C:\Users\11\bc-user-test\manual-profile-example.png
npx bc close
Get-Process chrome | Stop-Process -Force
npx bc browser status
```

Result:

- Profile list worked.
- `manual-profile` was created as a named profile.
- Profile list showed `manual-profile`.
- Profile use set `manual-profile` active.
- Managed browser launched with `Profile: manual-profile (named)`.
- `bc open https://example.com` reconnected to the managed browser and opened the page.
- Browser status showed `profileId: manual-profile`, `status: connected`, and `reachable: true`.
- Screenshot saved to `manual-profile-example.png`.
- `bc close` closed the tab.
- Killing Chrome caused browser status to show `status: disconnected` and `reachable: false`.

### Browser Auth Export And Import

Commands tested after the named-profile fixes:

```powershell
npx bc browser profile use manual-profile
npx bc browser launch --profile=manual-profile
npx bc open https://example.com
npx bc screenshot --output C:\Users\11\bc-user-test\manual-profile-regression.png
npx bc browser auth export --live --profile=manual-profile --output C:\Users\11\bc-user-test\manual-profile-auth.json --yes
Test-Path C:\Users\11\bc-user-test\manual-profile-auth.json
npx bc browser auth import C:\Users\11\bc-user-test\manual-profile-auth.json --stored --profile=manual-profile --yes
npx bc close
npx bc browser status
```

Result:

- Named profile launch restored multiple Chrome tabs.
- `bc open https://example.com` targeted the active/front tab instead of a hidden restored tab.
- Screenshot saved to `manual-profile-regression.png` and visually showed `Example Domain`.
- Live auth export required explicit `--yes`, created `manual-profile-auth.json`, and exported 3 cookies.
- Stored auth import required explicit `--yes` and saved the snapshot for `manual-profile`.
- `bc close` returned `{ "closed": true }` without hanging.
- Browser status changed to `disconnected` and `reachable: false` after the closed tab ended the managed browser.

### Policy Commands

Commands:

```powershell
npx bc policy list
npx bc policy inspect balanced
npx bc policy inspect trusted
npx bc policy export balanced C:\Users\11\bc-user-test\balanced-policy.json
Test-Path C:\Users\11\bc-user-test\balanced-policy.json
npx bc fs write C:\Users\11\bc-user-test\policy-write-test.txt --content "blocked by balanced policy"
Test-Path C:\Users\11\bc-user-test\policy-write-test.txt
npx bc fs read C:\Users\11\bc-user-test\hello.txt
npx bc term exec "echo policy-terminal-ok"
```

Result:

- Built-in policy list returned `safe`, `balanced`, and `trusted`.
- `balanced` and `trusted` inspection printed expected command, filesystem, browser, and low-level policy fields.
- `policy export balanced` created `balanced-policy.json`.
- Balanced policy correctly blocked direct `fs write` with `require_confirmation`; file was not created.
- Low-risk `fs read` worked.
- Moderate terminal one-shot command worked with audit logging.

### Daemon-Backed Terminal Sessions

Commands:

```powershell
npx bc daemon start
npx bc term open --name manual-term --json
npx bc term list
$termId = "<real terminal id from term open/list>"
npx bc term exec "echo daemon-terminal-ok" --session=$termId
npx bc term read --session=$termId
npx bc term snapshot --session=$termId
npx bc term close --session=$termId
npx bc daemon stop
```

Result:

- `daemon start` returned and printed readiness instead of hanging.
- `term open --json` created a daemon-backed terminal session and returned a terminal id.
- Terminal cwd defaulted to the caller directory (`C:\Users\11\bc-user-test`), not package `dist\src`.
- `term list` showed daemon terminal sessions.
- Using a real terminal id, `term exec`, `term read`, `term snapshot`, and `term close` succeeded.
- Leaving `$termId="<PASTE_TERMINAL_ID_HERE>"` is user error, but now fails cleanly with `Invalid terminal session id: <PASTE_TERMINAL_ID_HERE>` and no native assertion crash.

## Issues Found During Manual Testing

- CLI help originally pulled runtime modules and emitted dependency/security noise. Fixed by keeping help lightweight.
- Installed package originally included vulnerable Stagehand dependency tree by default. Fixed by making Stagehand optional.
- Browser actions originally lost state between CLI invocations. Fixed by reconnecting to the active managed browser.
- Browser status originally reported stale managed connections as connected. Fixed with CDP reachability validation.
- `tab list` originally returned blank titles. Fixed by reading each page title.
- `daemon start` could feel stuck because it waited silently for readiness. Fixed with a shorter readiness probe.
- Screenshot can timeout inside Playwright while waiting for screenshot internals. Added CDP fallback and temp-file output.
- Named profiles with restored tabs could navigate a hidden/background tab while the visible tab stayed on New Tab. Fixed by targeting Playwright's front page for actions.
- Named-profile screenshots could produce a 1x1 image when the CDP viewport was invalid. Fixed by normalizing tiny viewports and falling back to CDP capture for tiny screenshots.
- `bc close` could hang on restored named-profile tabs. Fixed with a bounded close plus CDP target-close fallback.
- `browser auth export --output` was ignored and high-risk auth commands had no explicit CLI confirmation path. Fixed with `--output` support and `--yes` confirmation.
- Live auth export could get stuck by re-attaching to Browser Control's own managed browser. Fixed by reconnecting to the active managed browser state first and releasing CLI handles.
- Terminal commands with invalid placeholder ids could trigger `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after a broker HTTP 400. Fixed by validating terminal ids before runtime calls and only invalidating broker runtime on transport failures.
- Daemon terminal sessions opened in the package directory when `--cwd` was omitted. Fixed by passing caller cwd from the CLI.
- `term snapshot` can expose full terminal environment, including secrets inherited from the caller. Treat snapshot output as sensitive until redaction is added.

## Not Yet Manually Confirmed

### MCP

```powershell
npx bc mcp serve
```

Needs a real MCP client test for tool discovery and calls.

### Remote Providers

```powershell
npx bc browser provider add test-custom --type=custom --endpoint=<cdp-url>
npx bc browser provider use test-custom
npx bc browser attach --provider=test-custom --cdp-url=<cdp-url>
npx bc browser provider remove test-custom
```

Browserless needs real `BROWSERLESS_ENDPOINT` and `BROWSERLESS_API_KEY`.

### Skills, Tasks, Schedules, Reports

```powershell
npx bc skill list
npx bc skill validate <name-or-path>
npx bc run --skill=<name> --action=<action>
npx bc schedule list
npx bc report generate
npx bc report view
```

### Debug Bundles And Observability

```powershell
npx bc debug console
npx bc debug network
npx bc debug bundle <id>
```

Needs a deliberately failing browser action to confirm debug bundle creation and redaction.

### Cross-Platform Install

Still needs install smoke tests on:

- macOS
- Linux
- WSL

### Published Install

Still needs install tests from the final distribution channel:

```powershell
npm install browser-control
npx bc --help
npx bc doctor
```
