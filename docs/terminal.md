# Terminal

Terminal tools run through the configured shell and PTY backend.

Common config keys:

```bash
bc config set terminalShell powershell
bc config set terminalCols 120
bc config set terminalRows 30
bc config set terminalResumePolicy resume
bc config set terminalAutoResume false
```

`bc doctor` checks `node-pty` availability and the default shell. `bc status` reports active terminal sessions when the daemon broker is reachable.

On Windows, daemon launch paths avoid visible helper windows unless explicitly configured with `daemonVisible=true`.

## Authority And Secrets

Terminal tools run arbitrary shell commands with the OS permissions of the Browser Control process. They are not sandboxed. Commands can write files, start processes, read environment variables, and reach the network.

Terminal open/exec/write/interrupt/close/resume actions are policy-classified. Serialized terminal environment and command metadata redact common secret key patterns such as password, token, API key, auth, cookie, credential, private key, and passphrase. Command output is preserved for usefulness, then known secret patterns are redacted in logs/debug bundles where those paths store evidence.
