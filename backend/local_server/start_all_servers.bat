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

echo.
echo Cleaning up old server processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq HTTPS Server 8443" >nul 2>&1
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Flask API 8081" >nul 2>&1

echo [1/2] Starting Node.js HTTPS Server (port 8443)...
start "HTTPS Server 8443" /min cmd /c "cd /d %~dp0\..\.. && node server.js"

echo [2/2] Starting Flask API Server (port 8081)...
start "Flask API 8081" /min cmd /c "cd /d %~dp0 && python server.py"

REM Wait a moment for servers to start
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   Servers Started Successfully!
echo ============================================
echo.
echo   Your Project:  https://localhost:8443
echo   Flask API:     https://localhost:8081
echo.
echo   Both servers are running in minimized windows.
echo   Close those windows to stop the servers.
echo ============================================
echo.

REM Open the project in browser
start "" "https://localhost:8443"

echo Press any key to close this window (servers will keep running)...
pause >nul
