@echo off
setlocal enabledelayedexpansion
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

REM Auto-detect Java 21 (Firebase Emulators require 21+)
set "JAVA_HOME="
for /d %%d in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do set "JAVA_HOME=%%d"
if "%JAVA_HOME%"=="" (
    echo WARNING: Java 21 not found. Firebase Emulators may fail.
    echo Install from: https://adoptium.net/temurin/releases/?version=21
) else (
    echo Found Java 21: %JAVA_HOME%
    set "PATH=%JAVA_HOME%\bin;%PATH%"
)

echo.
echo Cleaning up old server processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq HTTPS Server 8443" >nul 2>&1
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Flask API 8081" >nul 2>&1
taskkill /F /IM java.exe /FI "WINDOWTITLE eq Firebase Emulators" >nul 2>&1

echo [1/4] Starting Firebase Emulators (Firestore :8080, Auth :9099, Functions :5001, Storage :9199, UI :4000)...
start "Firebase Emulators" /min cmd /c "cd /d %~dp0\..\.. && set JAVA_HOME=%JAVA_HOME%&& set PATH=%JAVA_HOME%\bin;%PATH%&& npx firebase emulators:start --only firestore,auth,functions,storage --project listening-tasks-3ae34"

REM Wait for Auth emulator to become ready (up to 30 seconds)
echo Waiting for Auth emulator to be ready...
set EMULATOR_READY=0
for /L %%i in (1,1,30) do (
    if !EMULATOR_READY!==0 (
        timeout /t 1 /nobreak >nul
        curl.exe -s -o nul -w "%%{http_code}" http://127.0.0.1:9099/ >nul 2>&1
        if not errorlevel 1 set EMULATOR_READY=1
    )
)
if !EMULATOR_READY!==0 (
    echo WARNING: Auth emulator may not be ready. Seeding may fail.
)

REM [2/4] Load .env and seed admin account
echo [2/4] Seeding admin account into emulators...
if exist "%~dp0\..\..\..env" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0\..\..\.env") do (
        set "_key=%%A"
        if "!_key:~0,1!" neq "#" (
            set "%%A=%%B"
        )
    )
)
if not defined EMULATOR_ADMIN_EMAIL set "EMULATOR_ADMIN_EMAIL=%ADMIN_EMAIL%"
cd /d "%~dp0\..\.."
node scripts\seed-emulator-admin.js
cd /d "%~dp0"
echo.

echo [3/4] Starting Node.js HTTPS Server (port 8443 -> emulators)...
start "HTTPS Server 8443" /min cmd /c "cd /d %~dp0\..\.. && set FIRESTORE_EMULATOR_HOST=localhost:8080&& set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099&& set FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199&& set STORAGE_EMULATOR_HOST=http://localhost:9199&& node server.js"

echo [4/4] Starting Flask API Server (port 8081)...
start "Flask API 8081" /min cmd /c "cd /d %~dp0 && python server.py"

REM Wait a moment for servers to start
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   Servers Started Successfully!
echo ============================================
echo.
echo   Firebase UI:   http://localhost:4000
echo   Firestore:     localhost:8080
echo   Auth:          localhost:9099
echo   Functions:     localhost:5001
echo   Storage:       localhost:9199
echo   Your Project:  https://localhost:8443
echo   Flask API:     https://localhost:8081
echo.
echo   All servers are running in minimized windows.
echo   Close those windows to stop the servers.
echo ============================================
echo.

REM Open the project in browser
start "" "https://localhost:8443"

echo Press any key to close this window (servers will keep running)...
pause >nul
