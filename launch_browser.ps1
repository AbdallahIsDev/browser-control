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
$bridgeScriptPath = Join-Path $PSScriptRoot "wsl_cdp_bridge.cjs"
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

function Test-DebugChromeBinding {
  param($Process)

  if (-not $Process) {
    return $false
  }

  $listenerLines = @(netstat -ano -p TCP | Select-String -Pattern "LISTENING\s+$($Process.ProcessId)$")
  if ($listenerLines.Count -eq 0) {
    return $false
  }

  $nonLoopbackAddresses = @()
  foreach ($listener in $listenerLines) {
    if ($listener.Line -match "TCP\s+(\S+):$Port\s+\S+\s+LISTENING\s+$($Process.ProcessId)$") {
      $address = $Matches[1]
      if ($address -and $address -notin @("127.0.0.1", "::1")) {
        $nonLoopbackAddresses += $address
      }
    }
  }

  return ($nonLoopbackAddresses.Count -gt 0)
}

function Invoke-WslShell {
  param([string]$Command)

  $wslCommand = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if (-not $wslCommand) {
    return [pscustomobject]@{
      available = $false
      exitCode  = $null
      output    = ""
    }
  }

  try {
    $output = & $wslCommand.Source -e sh -lc $Command 2>&1
    return [pscustomobject]@{
      available = $true
      exitCode  = $LASTEXITCODE
      output    = (($output | Out-String).Trim())
    }
  } catch {
    return [pscustomobject]@{
      available = $true
      exitCode  = 1
      output    = ($_ | Out-String).Trim()
    }
  }
}

function Get-WslShellLines {
  param([string]$Command)

  $result = Invoke-WslShell -Command $Command
  if (-not $result.available -or $result.exitCode -ne 0 -or -not $result.output) {
    return @()
  }

  return @(
    $result.output -split "\r?\n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
}

function Test-PrivateIpv4Address {
  param([string]$Value)

  if (-not $Value -or $Value -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') {
    return $false
  }

  $octets = @($Matches[1], $Matches[2], $Matches[3], $Matches[4]) | ForEach-Object { [int]$_ }
  if ($octets | Where-Object { $_ -lt 0 -or $_ -gt 255 }) {
    return $false
  }

  return (
    $octets[0] -eq 10 -or
    ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or
    ($octets[0] -eq 192 -and $octets[1] -eq 168)
  )
}

function Get-WslHostCandidates {
  $candidates = @()

  $wslGateway = @(Get-WslShellLines -Command "ip route | sed -n 's/^default via //p' | cut -d' ' -f1 | head -n 1")
  if ($wslGateway.Count -gt 0) {
    $candidates += @($wslGateway | Where-Object { Test-PrivateIpv4Address -Value $_ })
  }

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
      $candidates += @($wslAddresses | Where-Object { Test-PrivateIpv4Address -Value $_ })
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
      $candidates += @($otherAddresses | Where-Object { Test-PrivateIpv4Address -Value $_ })
    }
  } catch {}

  $wslNameservers = @(Get-WslShellLines -Command "sed -n 's/^nameserver //p' /etc/resolv.conf")
  if ($wslNameservers.Count -gt 0) {
    $candidates += @($wslNameservers | Where-Object { Test-PrivateIpv4Address -Value $_ })
  }

  return @($candidates | Where-Object { $_ -and (Test-PrivateIpv4Address -Value $_) } | Select-Object -Unique)
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
  return [pscustomobject]$state
}

function Test-WslDebugEndpointValid {
  param([object]$InteropState)

  $candidateUrls = @()
  if ($InteropState -and $InteropState.wslPreferredUrl) {
    $candidateUrls += [string]$InteropState.wslPreferredUrl
  }

  foreach ($candidateHost in @($InteropState.wslHostCandidates)) {
    if ($candidateHost) {
      $candidateUrls += "http://${candidateHost}:$Port"
    }
  }

  $candidateUrls = @($candidateUrls | Where-Object { $_ } | Select-Object -Unique)
  if ($candidateUrls.Count -eq 0) {
    return $true
  }

  foreach ($candidateUrl in $candidateUrls) {
    $endpointUrl = "$candidateUrl/json"
    $pythonScript = "import urllib.request; urllib.request.urlopen(""$endpointUrl"", timeout=5).read()"
    $probeScript = "if command -v curl >/dev/null 2>&1; then curl -fsS '$endpointUrl' >/dev/null; elif command -v python3 >/dev/null 2>&1; then python3 -c '$pythonScript' >/dev/null; else exit 125; fi"
    $probeResult = Invoke-WslShell -Command $probeScript

    if (-not $probeResult.available) {
      return $true
    }

    if ($probeResult.exitCode -eq 0) {
      return $true
    }

    if ($probeResult.exitCode -eq 125) {
      Write-Output "Warning: WSL is available, but neither curl nor python3 is installed to probe the WSL debug endpoint."
      return $true
    }
  }

  return $false
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

function Get-WslBridgeProcess {
  param([string]$ListenHost)

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*$bridgeScriptPath*" -and
      $_.CommandLine -like "*--listen-host $ListenHost*" -and
      $_.CommandLine -like "*--listen-port $Port*" -and
      $_.CommandLine -like "*--target-host 127.0.0.1*" -and
      $_.CommandLine -like "*--target-port $Port*"
    } |
    Select-Object -First 1
}

function Stop-WslCdpBridge {
  param([string]$ListenHost)

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like "*$bridgeScriptPath*" -and
      $_.CommandLine -like "*--listen-port $Port*" -and
      (
        -not $ListenHost -or
        $_.CommandLine -like "*--listen-host $ListenHost*"
      )
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Start-WslCdpBridge {
  param([object]$InteropState)

  $listenHost = $null
  if ($InteropState -and $InteropState.wslPreferredUrl) {
    try {
      $listenHost = ([uri]$InteropState.wslPreferredUrl).Host
    } catch {}
  }

  if (-not $listenHost) {
    return $true
  }

  $bridgeUrl = "http://${listenHost}:$Port/json"
  if (Test-DebugEndpointValid -Url $bridgeUrl) {
    return $true
  }

  $nodePath = Get-NodePath
  if (-not $nodePath) {
    Write-Error "Node.js not found. Install Node or add node.exe to PATH."
    exit 1
  }

  if (-not (Test-Path $bridgeScriptPath)) {
    Write-Error "WSL bridge helper not found at $bridgeScriptPath"
    exit 1
  }

  Stop-WslCdpBridge -ListenHost $listenHost

  Start-Process -FilePath $nodePath -ArgumentList @(
    $bridgeScriptPath,
    "--listen-host", $listenHost,
    "--listen-port", "$Port",
    "--target-host", "127.0.0.1",
    "--target-port", "$Port"
  ) -WindowStyle Hidden | Out-Null

  for ($i = 0; $i -lt 10; $i++) {
    if (Test-DebugEndpointValid -Url $bridgeUrl) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
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
    if (-not (Test-DebugChromeBinding -Process $existingDebugProcess)) {
      Write-Output "Existing Chrome debug session is only bound to loopback. Starting WSL bridge repair..."
    }

    Ensure-DebugTabs
    $response = Get-CdpTargets
    $interopState = Write-DebugInteropState
    if ((Start-WslCdpBridge -InteropState $interopState) -and (Test-WslDebugEndpointValid -InteropState $interopState)) {
      Write-DebugReadyMessage -Response $response
      exit 0
    }

    Write-Output "Existing Chrome debug session is not reachable from WSL. Restarting..."
  } else {
    Write-Output "Existing Chrome debug session found but debug port is not responding. Restarting..."
  }

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
    $interopState = Write-DebugInteropState
    if (-not (Start-WslCdpBridge -InteropState $interopState)) {
      Write-Output "Attempt ${attempt}: WSL bridge validation failed."
      continue
    }

    if (-not (Test-WslDebugEndpointValid -InteropState $interopState)) {
      Write-Output "Attempt ${attempt}: WSL debug endpoint validation failed."
      continue
    }

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
$interopState = Write-DebugInteropState
Write-DebugReadyMessage -Response $response
exit 0
