# Terminal and Filesystem

Browser Control has native terminal sessions and structured filesystem actions.

## Terminal Commands

```powershell
$open = bc term open --shell powershell --cwd . --json | ConvertFrom-Json
$sessionId = $open.data.id
bc term exec "Get-Location" --json
bc term list
bc term read --session $sessionId
bc term type "echo hello`n" --session $sessionId
bc term interrupt --session $sessionId
bc term snapshot --session $sessionId
bc term close --session $sessionId
```

One-shot command:

```powershell
bc term exec "node --version" --json
```

Persistent session commands use a terminal session ID returned by `term open`.

## Resume and Status

```powershell
$open = bc term open --shell powershell --cwd . --json | ConvertFrom-Json
$sessionId = $open.data.id
bc term resume $sessionId
bc term status $sessionId
```

Resume is best-effort. It can preserve metadata and scrollback state, but cannot guarantee that a killed process or remote shell job is still alive after daemon shutdown.

Config:

```powershell
bc config set terminalShell powershell
bc config set terminalCols 120
bc config set terminalRows 30
bc config set terminalResumePolicy resume
bc config set terminalAutoResume true
```

## Windows Cleanup

Daemon launches avoid visible helper windows on Windows by default. Enable visible windows only for debugging:

```powershell
bc daemon start --visible
bc config set daemonVisible true
```

Cleanup commands:

```powershell
bc daemon stop
bc daemon status
bc daemon logs
```

Stale daemon/process metadata lives under `.interop` in the data home.

## Filesystem Commands

```powershell
bc fs read package.json
bc fs write .\tmp\demo.txt --content "hello"
bc fs ls . --recursive --ext .ts
bc fs stat package.json
bc fs move .\tmp\demo.txt .\tmp\demo-renamed.txt
bc fs rm .\tmp\demo-renamed.txt --force
```

Filesystem actions are structured Node operations, not shell emulation. Write, move, and delete can alter local data and are policy-governed.
