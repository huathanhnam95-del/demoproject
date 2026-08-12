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
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Phoneme Service 8082" >nul 2>&1
taskkill /F /IM java.exe /FI "WINDOWTITLE eq Firebase Emulators" >nul 2>&1

echo [1/5] Starting Firebase Emulators (Firestore :8080, Auth :9099, Functions :5001, Storage :9199, UI :4000)...
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
echo [2/5] Seeding admin account into emulators...
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

echo [3/5] Starting local phoneme recognizer (127.0.0.1:8082)...
REM Bind the local-only, auth-disabled recognizer to loopback. Do not use the
REM service module's 0.0.0.0 standalone default for this development target.
REM Start directly (without a nested cmd /c) so readiness failures are visible.
set "_LOCAL_PHONEME_PORT_SAVED=%PORT%"
pushd "%~dp0\..\.."
set "PORT=8082"
start "Phoneme Service 8082" /min python -m backend.phoneme_service.local_server
popd
set "PORT=%_LOCAL_PHONEME_PORT_SAVED%"
set "_LOCAL_PHONEME_PORT_SAVED="

REM Wait for lazy model readiness (cold load can exceed the API request timeout).
REM Measure a real clock, not a per-iteration counter. Each pass costs anywhere
REM from ~2s (connection refused, curl fails instantly) to ~7s (connect 1s +
REM max-time 5s + sleep 2s), so counting a fixed increment per pass is wrong in
REM both directions: it under-waits when the port is refusing and over-waits by
REM minutes when readiness requests keep timing out.
echo Waiting for phoneme service readiness (up to 180 seconds)...
set PHONEME_READY=0
set /a _PHONEME_WAIT_LIMIT=180
for /f "tokens=1-3 delims=:." %%a in ("!TIME: =0!") do set /a _PHONEME_START=((1%%a-100)*3600)+((1%%b-100)*60)+(1%%c-100)
set /a _PHONEME_WAITED=0
:phoneme_wait_loop
curl.exe -s -o nul --fail --connect-timeout 1 --max-time 5 http://127.0.0.1:8082/readyz >nul 2>&1
if not errorlevel 1 (
    set PHONEME_READY=1
    goto phoneme_wait_done
)
timeout /t 2 /nobreak >nul
for /f "tokens=1-3 delims=:." %%a in ("!TIME: =0!") do set /a _PHONEME_NOW=((1%%a-100)*3600)+((1%%b-100)*60)+(1%%c-100)
set /a _PHONEME_WAITED=!_PHONEME_NOW!-!_PHONEME_START!
REM Midnight rollover: elapsed cannot be negative.
if !_PHONEME_WAITED! lss 0 set /a _PHONEME_WAITED+=86400
if !_PHONEME_WAITED! lss !_PHONEME_WAIT_LIMIT! goto phoneme_wait_loop
:phoneme_wait_done
if !PHONEME_READY!==1 (
    echo Phoneme service is ready after !_PHONEME_WAITED!s; local V3 recognizer wiring enabled.
) else (
    echo.
    echo ############################################################
    echo #  WARNING: V3 IS DISABLED FOR THIS SESSION                #
    echo ############################################################
    echo #  The phoneme recognizer did not become ready on          #
    echo #  127.0.0.1:8082 within !_PHONEME_WAIT_LIMIT! seconds.               #
    echo #                                                          #
    echo #  Pronounce mode will show V3 as unavailable with         #
    echo #  RECOGNIZER_CONFIG_MISSING. This is a local setup gap,   #
    echo #  not a code defect - do not debug the analyzer.          #
    echo #                                                          #
    echo #  Fix: pip install -r backend\requirements.phoneme-torch.txt
    echo #  Then: set PORT=8082 ^&^& python -m backend.phoneme_service.local_server
    echo #  Verify: curl http://127.0.0.1:8082/readyz               #
    echo ############################################################
    echo.
)
echo.

echo [4/5] Starting Node.js HTTPS Server (port 8443 -> emulators)...
start "HTTPS Server 8443" /min cmd /c "cd /d %~dp0\..\.. && set FIRESTORE_EMULATOR_HOST=localhost:8080&& set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099&& set FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199&& set STORAGE_EMULATOR_HOST=http://localhost:9199&& node server.js"

echo [5/5] Starting Flask API Server (port 8081)...
if !PHONEME_READY!==1 (
    start "Flask API 8081" /min cmd /c "cd /d %~dp0 && set PHONEME_SERVICE_URL=http://127.0.0.1:8082&& set PHONEME_SERVICE_AUTH=disabled&& set PRONUNCIATION_V3_MODE=shadow&& python server.py"
) else (
    start "Flask API 8081" /min cmd /c "cd /d %~dp0 && set PHONEME_SERVICE_URL=&& set PHONEME_SERVICE_AUTH=&& set PRONUNCIATION_V3_MODE=off&& python server.py"
)

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
echo   Phoneme service: http://127.0.0.1:8082 (local-only auth bypass)
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
