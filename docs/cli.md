# CLI

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
