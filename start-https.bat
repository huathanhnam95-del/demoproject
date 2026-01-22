@echo off
:: Ensure we are in the script's directory (project root)
cd /d "%~dp0"

echo ===================================================
echo   Starting Secure Local Server (HTTPS)
echo   Port: 8443
echo ===================================================
echo.
echo Please wait...
echo.

:: Check if the certificate exists
if not exist "localhost.pem" (
    echo ERROR: Certificate 'localhost.pem' is missing.
    echo Running setup script...
    powershell -ExecutionPolicy Bypass -File "generate_cert.ps1"
)

:: Run the HTTPS server from project root
python backend\local_server\local_https_server.py

:: If python crashes or stops, pause so user can see why
echo.
echo Server stopped.
pause
