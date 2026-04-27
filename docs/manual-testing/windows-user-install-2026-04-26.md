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
- `term exec`, `term read`, and `term snapshot.lastOutput` now return clean command output instead of internal Browser Control marker/wrapper commands.
- `term snapshot` now redacts secret-looking environment values before printing.
- `skill list`, `skill validate`, `skill actions`, and `skill health` work without a running daemon and no longer print raw `fetch failed`.

### Browser Tab Switch And Screenshot

Commands:

```powershell
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
npx bc browser provider use local
npx bc open https://example.com
npx bc open https://www.iana.org/help/example-domains
npx bc tab list
npx bc tab switch 0
npx bc tab list
npx bc screenshot --output C:\Users\11\bc-user-test\tab-switch-test.png
Test-Path C:\Users\11\bc-user-test\tab-switch-test.png
npx bc close
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

Result:

- Local provider selection worked.
- Opening `example.com` launched managed Chrome.
- Opening the IANA example domains page reused the active tab.
- `tab list` returned one tab with URL `https://www.iana.org/help/example-domains` and title `Example Domains`.
- `tab switch 0` returned `{ "activeTab": "0" }`.
- Screenshot saved to `tab-switch-test.png`.
- `bc close` returned `{ "closed": true }`.

### Config Setup, List, Get, Set

Commands:

```powershell
npx bc config list
npx bc config get browserMode
npx bc config set browserMode managed
npx bc config get browserMode
npx bc config set browserMode managed --json
```

Result:

- Config list printed effective values and sources.
- `browserMode` initially came from default or user config depending on previous run state.
- `config set browserMode managed` succeeded with audit logging.
- JSON mode returned a parseable object with `key`, `value`, `source`, and `configPath`.

### Proxy Commands

Commands:

```powershell
npx bc proxy list
npx bc proxy test
npx bc proxy add http://127.0.0.1:9999
npx bc proxy list
npx bc proxy remove http://127.0.0.1:9999
npx bc proxy list
```

Result:

- Empty proxy config returned `[]`.
- Adding a local test proxy showed it as active.
- Removing it restored an empty proxy list.

### CAPTCHA, Report, And Memory Commands

Commands:

```powershell
npx bc captcha test
npx bc report generate
npx bc report view
npx bc memory stats
npx bc memory set test-key test-value
npx bc memory get test-key
npx bc memory clear
npx bc memory stats
```

Result:

- `captcha test` returned the expected configuration error when no CAPTCHA provider is configured.
- Report generation created a JSON report file and report view returned an empty event summary.
- Memory stats returned SQLite path, total key count, collections, and file size.
- Memory set/get worked.
- Memory clear removed all keys and stats returned `totalKeys: 0`.

Note:

- `memory clear` is destructive for Browser Control runtime memory in the selected `BROWSER_CONTROL_HOME`; use only in a disposable test home.

### Policy Export And Import

Commands:

```powershell
npx bc policy list
npx bc policy export safe C:\Users\11\bc-user-test\safe-policy.json
Test-Path C:\Users\11\bc-user-test\safe-policy.json
npx bc policy import C:\Users\11\bc-user-test\safe-policy.json
npx bc policy list
npx bc policy inspect safe
```

Result:

- Safe policy export created `safe-policy.json`.
- Import accepted the policy JSON and saved it successfully.
- Policy list showed built-in profiles and custom `safe`.
- Inspect printed the imported safe policy.

Open question:

- Importing a custom profile with the same name as a built-in profile is accepted. This may be intentional override behavior, but should be decided explicitly.

### Browser Provider Management

Commands:

```powershell
npx bc browser provider list
npx bc browser provider add testcustom --type=custom --endpoint=http://127.0.0.1:3000
npx bc browser provider list
npx bc browser provider use testcustom
npx bc browser provider list
npx bc browser provider remove testcustom
npx bc browser provider list
npx bc browser provider use local
```

Result:

- Provider list showed built-in providers.
- Custom provider add/use/remove worked.
- Removing the active custom provider restored `local` as active.
- Explicit `browser provider use local` worked.

### Browser Profile Delete

Commands:

```powershell
npx bc browser profile list
npx bc browser profile create delete-test-profile
npx bc browser profile list
npx bc browser profile delete delete-test-profile
npx bc browser profile list
```

Result:

- Test profile was created and appeared in profile list.
- Delete removed the profile.
- Final profile list no longer showed `delete-test-profile`.

### MCP Server Process Smoke

Commands:

```powershell
npx bc mcp serve --help
$mcp = Start-Process -FilePath "npx.cmd" -ArgumentList @("bc", "mcp", "serve") -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
$mcp.Refresh()
$mcp.HasExited
Get-Process -Id $mcp.Id
Stop-Process -Id $mcp.Id -Force
Start-Sleep -Seconds 1
Get-Process -Id $mcp.Id -ErrorAction SilentlyContinue
```

Result:

- MCP help printed CLI command list.
- Starting MCP through `npx.cmd` kept the process alive.
- Process could be stopped cleanly.
- Starting with `Start-Process npx ...` failed on Windows because `npx` is a command shim; `npx.cmd` is required.

### Knowledge Commands

Commands:

```powershell
npx bc knowledge list
npx bc knowledge validate --all
npx bc knowledge show example.com
npx bc knowledge prune example.com
```

Result:

- Empty knowledge store returned `No knowledge artifacts found`.
- Validate all returned `No knowledge artifacts to validate`.
- Show/prune for missing `example.com` returned clean `No knowledge found` errors.

### Skill Info Commands

Commands:

```powershell
npx bc skill list
npx bc skill validate framer
npx bc skill actions framer
npx bc skill health framer
```

Result:

- Skill list returned `adobe_stock`, `exness`, and `framer`.
- `skill validate framer` returned valid.
- `skill actions framer` listed available actions.
- `skill health framer` returned `healthy: false` because `OPENROUTER_API_KEY` is missing.

Note:

- Framer skill is old and expected to need future reconfiguration for the latest Browser Control features.

### Debug Console, Network, And Bundle Confirmation

Commands:

```powershell
npx bc debug console
npx bc debug network
npx bc debug bundle test-debug-id --output C:\Users\11\bc-user-test\debug-bundle.json
Test-Path C:\Users\11\bc-user-test\debug-bundle.json
npx bc debug bundle test-debug-id --output C:\Users\11\bc-user-test\debug-bundle.json --yes
Test-Path C:\Users\11\bc-user-test\debug-bundle.json
```

Result:

- Debug console returned `0 total` entries for default session.
- Debug network returned `0 total` entries for default session.
- Debug bundle without `--yes` was correctly blocked by policy confirmation.
- Debug bundle with `--yes` no longer stops at confirmation.
- Fake bundle id returned `Bundle "test-debug-id" not found`.
- Output file was not created because the bundle id was fake.

### Direct Browser Interaction Commands

Commands:

```powershell
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

mkdir C:\Users\11\bc-user-test\interaction-site -Force

@"
<!doctype html>
<html>
<head>
  <title>BC Interaction Test</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #hover-card { padding: 20px; background: #eee; border: 2px solid #999; width: 260px; }
    #hover-card:hover { background: #b7f7c2; border-color: #16803a; }
    #spacer { height: 1200px; }
    #bottom { padding: 32px; background: #def; }
  </style>
</head>
<body>
  <h1>BC Interaction Test</h1>
  <label>Name <input id="name" aria-label="Name" /></label>
  <br><br>
  <label>Notes <textarea id="notes" aria-label="Notes"></textarea></label>
  <br><br>
  <button id="copy-button" onclick="document.getElementById('result').textContent = document.getElementById('name').value + ' | ' + document.getElementById('notes').value">
    Copy To Result
  </button>
  <div id="hover-card">Hover target</div>
  <h2>Result Panel</h2>
  <div id="result">empty</div>
  <div id="spacer"></div>
  <div id="bottom">Bottom marker reached</div>
</body>
</html>
"@ | Set-Content C:\Users\11\bc-user-test\interaction-site\index.html

$interactionServer = Start-Process node -ArgumentList "-e `"require('http').createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(require('fs').readFileSync('C:/Users/11/bc-user-test/interaction-site/index.html'))}).listen(5678,'127.0.0.1')`"" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

npx bc open http://127.0.0.1:5678
npx bc snapshot
npx bc fill "#name" "Ada Lovelace"
npx bc click "#notes"
npx bc type "typed by bc"
npx bc press Enter
npx bc type "second line"
npx bc hover "#hover-card"
npx bc click "#copy-button"
npx bc screenshot --target "#result" --output C:\Users\11\bc-user-test\interaction-result-target.png
npx bc scroll down
npx bc screenshot --full-page --output C:\Users\11\bc-user-test\interaction-full-page.png
Test-Path C:\Users\11\bc-user-test\interaction-result-target.png
Test-Path C:\Users\11\bc-user-test\interaction-full-page.png
npx bc close
Stop-Process -Id $interactionServer.Id -Force
```

Result:

- Local test page opened with title `BC Interaction Test`.
- Snapshot returned 10 accessibility elements including `Name`, `Notes`, `Copy To Result`, and `Result Panel`.
- `fill "#name"` returned `{ "filled": "selector: #name" }`.
- `click "#notes"` focused the textarea.
- `type`, `press Enter`, and second `type` returned success.
- `hover "#hover-card"` returned success.
- `click "#copy-button"` returned success.
- Target screenshot for `#result` saved to `interaction-result-target.png`.
- `scroll down` returned `down 300px`.
- Full-page screenshot saved to `interaction-full-page.png`.
- Both `Test-Path` checks returned `True`.
- `bc close` returned `{ "closed": true }`.
- Test server stopped cleanly.

### Ref-Based Browser Interaction And Scroll Directions

Commands:

```powershell
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

mkdir C:\Users\11\bc-user-test\ref-site -Force

@"
<!doctype html>
<html>
<head>
  <title>BC Ref Test</title>
  <style>
    body { width: 1800px; height: 1800px; padding: 24px; font-family: sans-serif; }
    #wide { margin-left: 1100px; padding: 24px; background: #fde; width: 300px; }
    #low { margin-top: 1000px; padding: 24px; background: #def; width: 300px; }
  </style>
</head>
<body>
  <h1>BC Ref Test</h1>
  <input aria-label="Ref Name" id="ref-name">
  <button id="ref-button" onclick="document.getElementById('ref-result').textContent = document.getElementById('ref-name').value">Save Ref Name</button>
  <p id="ref-result">empty</p>
  <div id="wide">Right marker</div>
  <div id="low">Bottom marker</div>
</body>
</html>
"@ | Set-Content C:\Users\11\bc-user-test\ref-site\index.html

$refServer = Start-Process node -ArgumentList "-e `"require('http').createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(require('fs').readFileSync('C:/Users/11/bc-user-test/ref-site/index.html'))}).listen(6789,'127.0.0.1')`"" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

npx bc open http://127.0.0.1:6789
npx bc snapshot
npx bc fill e3 "Ref Works"
npx bc click e4
npx bc screenshot --target "#ref-result" --output C:\Users\11\bc-user-test\ref-result.png
npx bc scroll down
npx bc scroll up
npx bc scroll right
npx bc scroll left
npx bc screenshot --full-page --output C:\Users\11\bc-user-test\ref-full-page.png
Test-Path C:\Users\11\bc-user-test\ref-result.png
Test-Path C:\Users\11\bc-user-test\ref-full-page.png
npx bc close
Stop-Process -Id $refServer.Id -Force
```

Result:

- Local test page opened with title `BC Ref Test`.
- Snapshot returned refs `e3` for textbox `Ref Name` and `e4` for button `Save Ref Name`.
- `fill e3 "Ref Works"` succeeded.
- `click e4` succeeded.
- Ref store emitted warnings about no persisted snapshot, then regenerated the snapshot and resolved refs successfully. This is noisy but not a failure.
- Target screenshot for `#ref-result` saved to `ref-result.png`.
- Scroll directions `down`, `up`, `right`, and `left` all returned success.
- Full-page screenshot saved to `ref-full-page.png`.
- Both `Test-Path` checks returned `True`.
- `bc close` returned `{ "closed": true }`.
- Test server stopped cleanly.

### Filesystem List, Read Limits, Stat, Move, And Delete Policy

Commands:

```powershell
mkdir C:\Users\11\bc-user-test\fs-test -Force
mkdir C:\Users\11\bc-user-test\fs-test\nested -Force

Set-Content C:\Users\11\bc-user-test\fs-test\a.txt "alpha"
Set-Content C:\Users\11\bc-user-test\fs-test\b.log "bravo"
Set-Content C:\Users\11\bc-user-test\fs-test\nested\c.txt "charlie"

npx bc fs ls C:\Users\11\bc-user-test\fs-test
npx bc fs ls C:\Users\11\bc-user-test\fs-test --recursive
npx bc fs ls C:\Users\11\bc-user-test\fs-test --recursive --ext=.txt
npx bc fs read C:\Users\11\bc-user-test\fs-test\a.txt
npx bc fs read C:\Users\11\bc-user-test\fs-test\nested\c.txt --max-bytes=4
npx bc fs stat C:\Users\11\bc-user-test\fs-test\a.txt
npx bc fs move C:\Users\11\bc-user-test\fs-test\a.txt C:\Users\11\bc-user-test\fs-test\a-moved.txt
Test-Path C:\Users\11\bc-user-test\fs-test\a.txt
Test-Path C:\Users\11\bc-user-test\fs-test\a-moved.txt
npx bc fs rm C:\Users\11\bc-user-test\fs-test\a-moved.txt
Test-Path C:\Users\11\bc-user-test\fs-test\a-moved.txt
npx bc fs rm C:\Users\11\bc-user-test\fs-test --recursive --force
Test-Path C:\Users\11\bc-user-test\fs-test
```

Result:

- Non-recursive `fs ls` showed `a.txt`, `b.log`, and `nested`.
- Recursive `fs ls` showed four entries including `nested\c.txt`.
- Recursive `--ext=.txt` showed `a.txt`, `nested`, and `c.txt`; `b.log` was excluded.
- `fs read a.txt` returned `alpha`.
- `fs read c.txt --max-bytes=4` returned `File too large`; this is expected because `--max-bytes` is a safety cap, not truncation.
- `fs stat a.txt` returned file metadata with `exists: true`, `sizeBytes: 7`, and `isFile: true`.
- `fs move` was blocked by balanced policy with `require_confirmation`; source file remained and destination was not created.
- `fs rm a-moved.txt` was blocked by balanced policy with `require_confirmation`; destination already did not exist.
- Recursive forced delete was blocked by balanced policy with `Recursive delete requires confirmation`; test directory remained.

### JSON Output Mode

Commands tested before fix:

```powershell
npx bc status --json
npx bc doctor --json
npx bc session list --json
npx bc fs stat C:\Users\11\bc-user-test\json-test.txt --json
npx bc fs read C:\Users\11\bc-user-test\json-test.txt --json
npx bc open https://example.com --json
npx bc snapshot --json
npx bc tab list --json
npx bc screenshot --output C:\Users\11\bc-user-test\json-shot.png --json
Test-Path C:\Users\11\bc-user-test\json-shot.png
npx bc close --json
```

Result before fix:

- Commands returned JSON action results.
- Screenshot saved and `Test-Path` returned `True`.
- Problem found: `--json` output was visually polluted by logger lines and Node SQLite experimental warnings on stderr. Stdout remained usable when separated, but terminal copy/paste was not clean enough for machine-output mode.

Fix added:

- JSON mode now suppresses console logger output unless `BROWSER_CONTROL_JSON_LOGS=stderr` is set.
- JSON mode filters Node's SQLite experimental warning for CLI child processes.

Commands tested after fix:

```powershell
npx bc fs read C:\Users\11\bc-user-test\json-test.txt --json 1> C:\Users\11\bc-user-test\stdout.txt 2> C:\Users\11\bc-user-test\stderr.txt
Get-Content C:\Users\11\bc-user-test\stdout.txt -Raw | ConvertFrom-Json
Get-Content C:\Users\11\bc-user-test\stderr.txt
npx bc doctor --json 1> C:\Users\11\bc-user-test\stdout.txt 2> C:\Users\11\bc-user-test\stderr.txt
Get-Content C:\Users\11\bc-user-test\stdout.txt -Raw | ConvertFrom-Json
Get-Content C:\Users\11\bc-user-test\stderr.txt
```

Result after fix:

- `fs read --json` stdout parsed as JSON and returned content `json-ok`.
- `fs read --json` stderr was empty.
- `doctor --json` stdout parsed as JSON and returned overall `degraded`.
- `doctor --json` stderr was empty.

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
- `term snapshot` exposed full terminal environment, including secrets inherited from the caller. Fixed by redacting secret-looking env keys in snapshots.
- Session-bound terminal output printed internal marker/wrapper commands. Fixed by separating the raw PTY buffer from the public terminal output buffer.
- Skill info commands depended on the broker and printed raw `fetch failed` when the daemon was stopped. Fixed by loading skills locally for list/validate/actions/health and by supporting compiled `.js` skill files in packaged installs.
- `debug bundle --yes` was ignored and still required confirmation. Fixed by passing the parsed confirmation flag into debug bundle policy evaluation.
- `--json` commands emitted logger lines and SQLite experimental warnings to stderr, making terminal copy/paste noisy for machine-output mode. Fixed by suppressing console logs in JSON mode and filtering the SQLite experimental warning.

## Not Yet Manually Confirmed

### MCP Client Integration

```powershell
npx bc mcp serve
```

Process startup is confirmed. Still needs a real MCP client test for tool discovery and tool calls.

### Remote Providers

```powershell
npx bc browser provider add test-custom --type=custom --endpoint=<cdp-url>
npx bc browser provider use test-custom
npx bc browser attach --provider=test-custom --cdp-url=<cdp-url>
npx bc browser provider remove test-custom
```

Browserless needs real `BROWSERLESS_ENDPOINT` and `BROWSERLESS_API_KEY`.

### Skill Run, Tasks, And Schedules

```powershell
npx bc run --skill=<name> --action=<action>
npx bc schedule <id> --cron="*/5 * * * *" --skill=<name> --action=<action>
npx bc schedule list
npx bc schedule pause <id>
npx bc schedule resume <id>
npx bc schedule remove <id>
```

Skill info commands and report commands are confirmed. Skill execution and schedules still need dedicated tests.

### Debug Bundles And Observability

```powershell
npx bc open <page-that-causes-console-or-network-events>
npx bc debug console --session=<session-id>
npx bc debug network --session=<session-id>
npx bc debug bundle <real-debug-bundle-id> --output=<file> --yes
```

Console/network empty-state and `debug bundle --yes` confirmation are confirmed. Still needs a deliberately failing browser action to confirm real debug bundle creation and redaction.

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
