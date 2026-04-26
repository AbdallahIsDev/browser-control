# CLI

Requires Node.js `>=22`. From a clean checkout, build first:

```bash
npm ci
npm run build
node cli.js --help
```

From an installed package, use `bc`:

```bash
npx bc --help
bc --help
```

Operator commands:

```bash
bc doctor
bc doctor --json

bc setup
bc setup --non-interactive --profile balanced
bc setup --non-interactive --skip-browser-test --skip-terminal-test
bc setup --json

bc config list
bc config list --json
bc config get logLevel
bc config get logLevel --json
bc config set logLevel debug
bc config set browserMode attach
bc config set openrouterApiKey sk-...

bc status
bc status --json
```

JSON output is machine-parseable and does not include normal human log text. Secrets are redacted in human and JSON config output.

`bc doctor` exits `0` when there are no critical failures and `1` when critical failures exist. Warnings do not fail doctor.

Chrome/CDP warnings do not block terminal or filesystem use. Browser commands need Chrome, `BROWSER_CHROME_PATH`, or `BROWSER_DEBUG_URL`.

PowerShell isolated run:

```powershell
$env:BROWSER_CONTROL_HOME = Join-Path $env:TEMP ("browser-control-" + [guid]::NewGuid().ToString())
bc setup --non-interactive --json
bc doctor --json
bc status --json
```

Linux/macOS isolated run:

```bash
BC_HOME="$(mktemp -d)"
BROWSER_CONTROL_HOME="$BC_HOME" bc setup --non-interactive --json
BROWSER_CONTROL_HOME="$BC_HOME" bc doctor --json
```
