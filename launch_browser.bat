@echo off
setlocal

:: Preferred usage: launch_browser.bat
:: Optional arg: [port]
:: Default: port=9222

set PORT=9222

if not "%~1"=="" set PORT=%~1

powershell -ExecutionPolicy Bypass -File "%~dp0launch_browser.ps1" ^
  -Port %PORT%

endlocal
