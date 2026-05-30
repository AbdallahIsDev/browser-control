@echo off
setlocal

:: Browser Control — Chrome launcher (Windows)
:: Usage: launch_browser.bat [port] [bindAddress]
:: Defaults: port=9222, bindAddress=127.0.0.1

set PORT=%1
set BIND_ADDRESS=%2

if "%PORT%"=="" set PORT=9222
if "%BIND_ADDRESS%"=="" set BIND_ADDRESS=127.0.0.1

if /I "%BIND_ADDRESS%"=="0.0.0.0" if /I not "%BROWSER_ALLOW_REMOTE_CDP%"=="1" (
  echo Error: Refusing unsafe Chrome CDP bind address %BIND_ADDRESS%. Use 127.0.0.1 or set BROWSER_ALLOW_REMOTE_CDP=1 to expose CDP beyond this machine. 1>&2
  exit /b 1
)
if "%BIND_ADDRESS%"=="::" if /I not "%BROWSER_ALLOW_REMOTE_CDP%"=="1" (
  echo Error: Refusing unsafe Chrome CDP bind address %BIND_ADDRESS%. Use 127.0.0.1 or set BROWSER_ALLOW_REMOTE_CDP=1 to expose CDP beyond this machine. 1>&2
  exit /b 1
)

node "%~dp0scripts\launch_browser.cjs" %PORT% %BIND_ADDRESS%
set EXIT_CODE=%ERRORLEVEL%
endlocal & exit /b %EXIT_CODE%
