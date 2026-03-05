@echo off
setlocal
:: Ensure we are in the script's directory (project root)
cd /d "%~dp0"

echo ===================================================
echo   Local Server Diagnostic ^& Start Script
echo ===================================================
echo.

:: 1. Check Certificates
echo Checking SSL certificates...
if exist "localhost.pem" (
    if exist "localhost-key.pem" (
        echo [OK] Trusted certificates localhost.pem/key found.
    ) else (
        echo [WARNING] localhost.pem found but localhost-key.pem is missing.
    )
) else (
    echo [MISSING] localhost.pem is missing.
)

:: 2. Check Port 8443
echo Checking port 8443...
netstat -ano | findstr :8443 > nul
if %errorlevel% equ 0 (
    echo [BUSY] Port 8443 is already in use. 
    echo Please close other server instances or terminals running node server.js.
    pause
    exit /b
) else (
    echo [OK] Port 8443 is available.
)

:: 3. Start Server
echo.
echo Starting server...
echo ---------------------------------------------------
node server.js

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server failed to start or crashed.
    pause
)
endlocal
