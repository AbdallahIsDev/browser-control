@echo off
setlocal

:: Preferred usage: launch_browser.bat
:: Optional arg: [port]
:: Default: port=9222

set PORT=9222

if not "%~1"=="" set PORT=%~1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_browser.ps1" -Port %PORT%
set EXIT_CODE=%ERRORLEVEL%
endlocal & exit /b %EXIT_CODE%
