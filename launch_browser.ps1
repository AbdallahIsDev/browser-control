param(
  [int]    $Port            = 9222,
  [string] $ChromeOverride  = "",
  [string] $BindAddress     = "0.0.0.0"
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
$lockFile         = Join-Path $debugUserDataDir "lockfile"
$debugUrl         = "http://127.0.0.1:$Port/json"
$launcherHelperPath = Join-Path $PSScriptRoot "launch_browser_helper.cjs"
$interopDir       = Join-Path $PSScriptRoot ".interop"
$interopPath      = Join-Path $interopDir "chrome-debug.json"

# ─── Helpers ─────────────────────────────────────────────────────────────────
function Get-CdpTargets {
  try {
    return (Invoke-WebRequest -UseBasicParsing $debugUrl -TimeoutSec 3).Content
  } catch { return $null }
}

function Write-DebugReadyMessage {
  param([string] $Response)

  $targetCount = $null
  if ($Response) {
    try {
      $targets = $Response | ConvertFrom-Json
      $targetCount = @($targets).Count
    } catch {}
  }

  if ($null -ne $targetCount) {
    Write-Output "SUCCESS: Chrome debug session ready on port $Port ($targetCount targets)"
    return
  }

  Write-Output "SUCCESS: Chrome debug session ready on port $Port"
}

function Get-NodePath {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-DebugChromeProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*--remote-debugging-port=$Port*" -and
      $_.CommandLine -like "*$debugUserDataDir*" -and
      $_.CommandLine -notlike "*--type=*"
    } |
    Select-Object -First 1
}

function Get-WslHostCandidates {
  $candidates = @()

  try {
    $wslAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.InterfaceAlias -like "vEthernet (WSL*"
      } |
      Select-Object -ExpandProperty IPAddress

    if ($wslAddresses) {
      $candidates += $wslAddresses
    }
  } catch {}

  try {
    $otherAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*"
      } |
      Select-Object -ExpandProperty IPAddress

    if ($otherAddresses) {
      $candidates += $otherAddresses
    }
  } catch {}

  return @($candidates | Where-Object { $_ } | Select-Object -Unique)
}

function Write-DebugInteropState {
  $wslHostCandidates = @(Get-WslHostCandidates)
  $wslPreferredUrl = $null
  if ($wslHostCandidates.Count -gt 0) {
    $wslPreferredUrl = "http://$($wslHostCandidates[0]):$Port"
  }

  $state = [ordered]@{
    port               = $Port
    bindAddress        = $BindAddress
    windowsLoopbackUrl = "http://127.0.0.1:$Port"
    localhostUrl       = "http://localhost:$Port"
    wslPreferredUrl    = $wslPreferredUrl
    wslHostCandidates  = $wslHostCandidates
    updatedAt          = (Get-Date).ToUniversalTime().ToString("o")
  }

  New-Item -ItemType Directory -Force -Path $interopDir | Out-Null
  $state | ConvertTo-Json -Depth 4 | Set-Content -Path $interopPath -Encoding UTF8
}

function Stop-DebugChrome {
  Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like "*$debugUserDataDir*" -or
        $_.CommandLine -like "*--remote-debugging-port=$Port*"
      )
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  Start-Sleep -Seconds 2
}

function Start-DebugChrome {
  $nodePath = Get-NodePath
  if (-not $nodePath) {
    Write-Error "Node.js not found. Install Node or add node.exe to PATH."
    exit 1
  }

  if (-not (Test-Path $launcherHelperPath)) {
    Write-Error "Launcher helper not found at $launcherHelperPath"
    exit 1
  }

  & $nodePath $launcherHelperPath "$Port" $debugUserDataDir "http://127.0.0.1:$Port/json" $chromePath "$BindAddress"
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

# ─── Validation helpers ──────────────────────────────────────────────────────
function Test-DebugEndpointValid {
  param([string]$Url)
  try {
    $content = (Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 5).Content
    if (-not $content) { return $false }
    $parsed = $content | ConvertFrom-Json -ErrorAction Stop
    return ($null -ne $parsed)
  } catch {
    return $false
  }
}

function Open-DebugTab {
  param([string]$Url)
  $nodePath = Get-NodePath
  if (-not $nodePath) {
    Write-Output "Warning: Node.js not found, cannot open tab"
    return $null
  }
  $helperScript = Join-Path $PSScriptRoot "open_debug_tab.cjs"
  if (-not (Test-Path $helperScript)) {
    Write-Output "Warning: open_debug_tab.cjs not found"
    return $null
  }
  try {
    $result = & $nodePath $helperScript "$Port" "$Url" 2>&1
    return $result
  } catch {
    Write-Output "Warning: Failed to open tab for $Url - $_"
    return $null
  }
}

function Test-DebugSessionValid {
  $url1 = "http://127.0.0.1:$Port/json"
  $url2 = "http://localhost:$Port/json"

  $valid1 = Test-DebugEndpointValid -Url $url1
  $valid2 = Test-DebugEndpointValid -Url $url2

  return ($valid1 -and $valid2)
}

# ─── Ensure the two JSON validation tabs exist ───────────────────────────────
function Ensure-DebugTabs {
  $debugUrl1 = "http://127.0.0.1:$Port/json"
  $debugUrl2 = "http://localhost:$Port/json"
  $hasUrl1 = $false
  $hasUrl2 = $false

  try {
    $targets = (Get-CdpTargets) | ConvertFrom-Json
    foreach ($t in $targets) {
      if ($t.type -eq "page") {
        if ($t.url -eq $debugUrl1) { $hasUrl1 = $true }
        if ($t.url -eq $debugUrl2) { $hasUrl2 = $true }
      }
    }
  } catch {}

  if (-not $hasUrl1) { Open-DebugTab -Url $debugUrl1 | Out-Null }
  if (-not $hasUrl2) { Open-DebugTab -Url $debugUrl2 | Out-Null }

  if ((-not $hasUrl1) -or (-not $hasUrl2)) {
    Start-Sleep -Seconds 2
  }
}

# ─── Reuse the shared automation session if already running ──────────────────
$existingDebugProcess = Get-DebugChromeProcess
if ($existingDebugProcess) {
  $response = Get-CdpTargets
  if ($response) {
    Ensure-DebugTabs
    $response = Get-CdpTargets
    Write-DebugInteropState
    Write-DebugReadyMessage -Response $response
    exit 0
  }
  # Existing process but debug port not responding — kill it and start fresh
  Write-Output "Existing Chrome debug session found but debug port is not responding. Restarting..."
  Stop-DebugChrome
}

# ─── Launch + verify with retry (up to 3 attempts) ──────────────────────────
$maxRetries = 3
$success = $false

for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
  if ($attempt -gt 1) {
    Write-Output "Retry attempt $attempt of $maxRetries..."
    Stop-DebugChrome
  }

  New-Item -ItemType Directory -Force -Path $debugUserDataDir | Out-Null
  if (Test-Path $lockFile) {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  }

  Start-DebugChrome

  # Wait for the debug port to accept connections (up to 15 seconds)
  $response = $null
  for ($i = 0; $i -lt 15; $i++) {
    $response = Get-CdpTargets
    if ($response) { break }
    Start-Sleep -Seconds 1
  }

  if (-not $response) {
    Write-Output "Attempt ${attempt}: Chrome debug endpoint at $debugUrl did not respond."
    continue
  }

  # Open the second validation tab (first one is already open from Chrome launch)
  Open-DebugTab -Url "http://localhost:$Port/json"
  Start-Sleep -Seconds 2

  # Validate both endpoints return valid JSON
  if (Test-DebugSessionValid) {
    $success = $true
    break
  }

  Write-Output "Attempt ${attempt}: Debug endpoint validation failed (invalid JSON or unreachable)."
}

if (-not $success) {
  Write-Output "FAILED: Could not establish a valid Chrome debug session after $maxRetries attempts."
  Stop-DebugChrome
  exit 1
}

$response = Get-CdpTargets
Write-DebugInteropState
Write-DebugReadyMessage -Response $response
exit 0
