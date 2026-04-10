@echo off
setlocal

:: Preferred usage: launch_browser.bat
:: Optional args: [port] [bindAddress]
:: Defaults: port=9222, bindAddress=0.0.0.0

set PORT=9222
set BIND_ADDRESS=0.0.0.0

if not "%~1"=="" set PORT=%~1
if not "%~2"=="" set BIND_ADDRESS=%~2

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_browser.ps1" -Port %PORT% -BindAddress %BIND_ADDRESS%
set EXIT_CODE=%ERRORLEVEL%
endlocal & exit /b %EXIT_CODE%
