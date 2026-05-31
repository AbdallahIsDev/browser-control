param(
  [int]    $Port            = 9222,
  [string] $BindAddress     = "127.0.0.1"
)

# Browser Control — Chrome launcher (Windows/PowerShell)
# Thin wrapper around scripts/launch_browser.ts (via .cjs shim)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherShim = Join-Path (Join-Path $scriptDir "scripts") "launch_browser.cjs"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $nodeCmd = @{ Source = $candidate }
      break
    }
  }
}

if (-not $nodeCmd) {
  Write-Error "Node.js not found. Install Node.js or add node.exe to PATH."
  exit 1
}

if (($BindAddress -eq "0.0.0.0" -or $BindAddress -eq "::") -and $env:BROWSER_ALLOW_REMOTE_CDP -ne "1") {
  Write-Error "Refusing unsafe Chrome CDP bind address $BindAddress. Use 127.0.0.1 or set BROWSER_ALLOW_REMOTE_CDP=1 to expose CDP beyond this machine."
  exit 1
}

& $nodeCmd.Source $launcherShim "$Port" "$BindAddress"
exit $LASTEXITCODE
