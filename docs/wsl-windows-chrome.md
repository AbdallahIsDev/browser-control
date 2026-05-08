# WSL + Visible Windows Chrome

Browser Control keeps Chrome CDP private by default. Native Windows launchers bind CDP to `127.0.0.1`; do not bind CDP to `0.0.0.0` unless you intentionally accept that other reachable local-network processes may control the browser.

## Native Windows

From PowerShell in the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launch_browser.ps1
```

Batch file from PowerShell:

```powershell
cmd.exe /C launch_browser.bat
```

Do not run `.bat` with PowerShell `-File`; `-File` is for `.ps1`.

## WSL Attach Flow

From WSL, install or link the Browser Control CLI so `bc` resolves to this project, not the Linux calculator:

```sh
cd /mnt/c/path/to/browser-control
npm link
sh scripts/install_wsl_bc.sh
export PATH="$HOME/.local/bin:$PATH"
hash -r
bc --help
```

If `bc --help` opens the Linux calculator, put `~/.local/bin` before `/usr/bin`, then run `hash -r`.

To control visible Windows Chrome from WSL, start Windows Chrome through the Windows launcher with the explicit bridge enabled:

```sh
cd /mnt/c/path/to/browser-control
/mnt/c/Windows/System32/cmd.exe /C "set BROWSER_ENABLE_WSL_CDP_BRIDGE=1&& launch_browser.bat 9222"
bc browser attach --port=9222 --yes
bc open https://example.com --json
bc screenshot --json
```

Without `--output`, screenshots are saved under the Browser Control runtime screenshots directory.

The Windows launcher uses the system Chrome profile by default (`BROWSER_LAUNCH_PROFILE=system`) so there is one visible Chrome profile with your normal account, extensions, and New Tab page. Chrome cannot add remote debugging to an already-running non-CDP profile. If Chrome is already open and port `9222` is not reachable, close all Chrome windows first, then run the launcher once. To intentionally use a separate Browser Control profile, set `BROWSER_LAUNCH_PROFILE=isolated`.

The launcher writes CDP metadata to the Browser Control data home under `.interop/chrome-debug.json`. Browser Control uses that metadata plus WSL gateway candidates when attaching.

If Linux Chrome is not installed in WSL, `bc browser launch` cannot launch visible Windows Chrome. Start the Windows launcher or bridge, then attach.

## MCP

Start MCP from the same environment that will run the agent:

```sh
cd /mnt/c/path/to/browser-control
bc mcp serve
```

Then use `bc_browser_attach` with `port: 9222`, followed by `bc_browser_open`, `bc_browser_snapshot`, and `bc_browser_screenshot`.

## Daemon

Daemon-backed terminal and session tools:

```sh
cd /mnt/c/path/to/browser-control
bc daemon start
bc status --json
```

Status output includes the data home, broker URL, PID when known, and broker probe result. Daemon logs are under the Browser Control data home logs directory.
