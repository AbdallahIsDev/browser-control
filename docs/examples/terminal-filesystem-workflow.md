# Terminal and Filesystem Workflow Example

PowerShell:

```powershell
bc term exec "node --version" --json
bc fs write .\tmp\demo.txt --content "hello from Browser Control"
bc fs read .\tmp\demo.txt
bc fs stat .\tmp\demo.txt --json
bc fs rm .\tmp\demo.txt --force
```

Persistent terminal:

```powershell
bc term open --shell powershell --cwd .
bc term list --json
```

Use the returned terminal session ID for `term read`, `term type`, `term interrupt`, and `term close`.
