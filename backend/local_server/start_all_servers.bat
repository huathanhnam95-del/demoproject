@echo off
title Local Development Servers
cd /d "%~dp0"

echo ============================================
echo   Starting Local Development Servers
echo ============================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found in PATH
    pause
    exit /b 1
)

echo [1/2] Starting HTTPS Static Server (port 8443)...
start "HTTPS Server 8443" /min cmd /c "cd /d %~dp0 && python local_https_server.py"

echo [2/2] Starting Flask API Server (port 8080)...
start "Flask API 8080" /min cmd /c "cd /d %~dp0 && python server.py"

REM Wait a moment for servers to start
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   Servers Started Successfully!
echo ============================================
echo.
echo   Your Project:  https://localhost:8443
echo   Flask API:     https://localhost:8080
echo.
echo   Both servers are running in minimized windows.
echo   Close those windows to stop the servers.
echo ============================================
echo.

REM Open the project in browser
start "" "https://localhost:8443"

echo Press any key to close this window (servers will keep running)...
pause >nul
