param(
  [int]    $Port            = 9222,
  [string] $ChromeOverride  = ""
)

# ─── Locate Chrome ────────────────────────────────────────────────────────────
$chromePath = $ChromeOverride
if (-not $chromePath) {
  $candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $chromePath = $c; break }
  }
}
if (-not $chromePath) {
  Write-Error "Chrome not found. Pass -ChromeOverride with the full path."
  exit 1
}

# ─── Shared automation profile ────────────────────────────────────────────────
$profileName      = "CodexDebugProfile"
$debugUserDataDir = Join-Path "$env:LOCALAPPDATA\\Google\\Chrome" $profileName
$localStatePath   = Join-Path $debugUserDataDir "Local State"
$lockFile         = Join-Path $debugUserDataDir "lockfile"
$debugUrl         = "http://localhost:$Port/json"

# ─── Helpers ─────────────────────────────────────────────────────────────────
function Get-CdpTargets {
  try {
    return (Invoke-WebRequest -UseBasicParsing $debugUrl -TimeoutSec 3).Content
  } catch { return $null }
}

function Get-PreferredProfileDirectory {
  if (Test-Path $localStatePath) {
    try {
      $localState = Get-Content -Raw $localStatePath | ConvertFrom-Json
      $lastUsed = $localState.profile.last_used
      if (-not [string]::IsNullOrWhiteSpace($lastUsed)) {
        return $lastUsed
      }
    } catch {}
  }
  return "Default"
}

function Get-DebugChromeProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*--remote-debugging-port=$Port*" -and
      $_.CommandLine -like "*$profileName*" -and
      $_.CommandLine -notlike "*--type=*"
    } |
    Select-Object -First 1
}

function Stop-DebugChrome {
  Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like "*$profileName*" -or
        $_.CommandLine -like "*--remote-debugging-port=$Port*"
      )
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  Start-Sleep -Seconds 2
}

# ─── Reuse the shared automation session if already running ──────────────────
$existingDebugProcess = Get-DebugChromeProcess
$response = Get-CdpTargets

if ($existingDebugProcess -and $response) {
  Write-Output "SUCCESS: Chrome debug session ready on port $Port"
  Write-Output $response
  exit 0
}

# ─── Launch Chrome on the shared automation profile ──────────────────────────
Stop-DebugChrome

New-Item -ItemType Directory -Force -Path $debugUserDataDir | Out-Null
if (Test-Path $lockFile) {
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

$profileDirectory = Get-PreferredProfileDirectory

Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$debugUserDataDir",
  "--profile-directory=$profileDirectory",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-mode"
) | Out-Null

# ─── Wait for endpoint (up to 15 seconds) ────────────────────────────────────
for ($i = 0; $i -lt 15; $i++) {
  $response = Get-CdpTargets
  if ($response) { break }
  Start-Sleep -Seconds 1
}

if (-not $response) {
  Write-Output "FAILED: Chrome debug endpoint at $debugUrl did not become ready."
  exit 1
}

Write-Output "SUCCESS: Chrome debug session ready on port $Port"
Write-Output $response
