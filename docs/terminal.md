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
