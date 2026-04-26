@echo off
setlocal

:: Browser Control — Chrome launcher (Windows)
:: Usage: launch_browser.bat [port] [bindAddress]
:: Defaults: port=9222, bindAddress=127.0.0.1

set PORT=%1
set BIND_ADDRESS=%2

if "%PORT%"=="" set PORT=9222
if "%BIND_ADDRESS%"=="" set BIND_ADDRESS=127.0.0.1

node "%~dp0scripts\launch_browser.cjs" %PORT% %BIND_ADDRESS%
set EXIT_CODE=%ERRORLEVEL%
endlocal & exit /b %EXIT_CODE%
