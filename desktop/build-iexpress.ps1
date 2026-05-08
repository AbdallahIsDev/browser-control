param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Output = ""
)

$ErrorActionPreference = "Stop"

if ($Output -eq "") {
  $Output = Join-Path $Root "desktop\bin\Browser Control.exe"
}

$launcherDir = Join-Path $Root "desktop\BrowserControlLauncher"
$sedPath = Join-Path $launcherDir "build-iexpress.sed"
$vbsPath = Join-Path $launcherDir "launch-browser-control.vbs"
$outputDir = Split-Path -Parent $Output

New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$escapedRoot = $Root.Replace('"', '""')
$vbs = @"
Option Explicit

Dim shell, fso, root, cli, node, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = "$escapedRoot"
cli = fso.BuildPath(root, "cli.js")

If Not fso.FileExists(cli) Then
  MsgBox "Browser Control CLI not found: " & cli, vbCritical, "Browser Control"
  WScript.Quit 1
End If

node = shell.ExpandEnvironmentStrings("%BROWSER_CONTROL_NODE%")
If node = "%BROWSER_CONTROL_NODE%" Or Len(node) = 0 Then
  node = "node"
End If

shell.CurrentDirectory = root
command = Chr(34) & node & Chr(34) & " " & Chr(34) & cli & Chr(34) & " desktop start --json"
shell.Run command, 0, False
"@
Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$Output
FriendlyName=Browser Control
AppLaunched=wscript.exe launch-browser-control.vbs
PostInstallCmd=<None>
AdminQuietInstCmd=wscript.exe launch-browser-control.vbs
UserQuietInstCmd=wscript.exe launch-browser-control.vbs
SourceFiles=SourceFiles

[Strings]
FILE0="launch-browser-control.vbs"

[SourceFiles]
SourceFiles0=$launcherDir\

[SourceFiles0]
%FILE0%=
"@
Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII

$iexpress = Join-Path $env:SystemRoot "System32\iexpress.exe"
if (-not (Test-Path $iexpress)) {
  throw "iexpress.exe not found at $iexpress"
}

& $iexpress /N $sedPath
if (($LASTEXITCODE -ne 0) -and (-not (Test-Path $Output))) {
  throw "IExpress failed with exit code $LASTEXITCODE"
}

Write-Output $Output
