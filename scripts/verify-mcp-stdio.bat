@echo off
REM verify-mcp-stdio.bat
REM Verifies Browser Control MCP stdio server works correctly.
REM Usage: verify-mcp-stdio.bat [path-to-cli.js]

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "SCRIPT_DIR=%~dp0"
set "VERIFY_SCRIPT=%SCRIPT_DIR%verify-mcp-stdio.js"

if not exist "%VERIFY_SCRIPT%" (
    echo ERROR: verify-mcp-stdio.js not found at %VERIFY_SCRIPT%
    exit /b 1
)

if "%~1"=="" (
    "%NODE_EXE%" "%VERIFY_SCRIPT%"
) else (
    "%NODE_EXE%" "%VERIFY_SCRIPT%" "%~1"
)

exit /b %ERRORLEVEL%
