@echo off
setlocal enabledelayedexpansion
:: Start Firebase Emulators + local HTTPS dev server
:: ---------------------------------------------------
:: Emulator UI:  http://localhost:4000
:: Firestore:    localhost:8080
:: Auth:         localhost:9099
:: Functions:    localhost:5001
:: Storage:      localhost:9199
:: HTTPS Server: https://localhost:8443
:: ---------------------------------------------------

cd /d "%~dp0"

:: Auto-detect Java 21 (Firebase Emulators require 21+)
set "JAVA_HOME="
for /d %%d in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do set "JAVA_HOME=%%d"
if "%JAVA_HOME%"=="" (
    echo WARNING: Java 21 not found. Firebase Emulators may fail.
    echo Install from: https://adoptium.net/temurin/releases/?version=21
) else (
    echo Found Java 21: %JAVA_HOME%
    set "PATH=%JAVA_HOME%\bin;%PATH%"
)

echo ===================================================
echo   Starting Firebase Emulators + Local Server
echo ===================================================
echo.

:: Persist emulator state (Auth/Firestore/Storage) so admin accounts don't vanish on restart.
set "EMULATOR_DATA_DIR=.local\\firebase-emulator-data"
if not exist "%EMULATOR_DATA_DIR%" (
    mkdir "%EMULATOR_DATA_DIR%" >nul 2>&1
)

:: Only import if an export manifest exists; otherwise start fresh and export on exit.
set "EMULATOR_IMPORT_ARGS="
if exist "%EMULATOR_DATA_DIR%\\firebase-export-metadata.json" (
    set "EMULATOR_IMPORT_ARGS=--import=\"%EMULATOR_DATA_DIR%\""
)

:: Start emulators in the background
start "Firebase Emulators" cmd /c "set JAVA_HOME=%JAVA_HOME%&& set PATH=%JAVA_HOME%\bin;%PATH%&& npx firebase emulators:start --only firestore,auth,functions,storage --project listening-tasks-3ae34 %EMULATOR_IMPORT_ARGS% --export-on-exit=\"%EMULATOR_DATA_DIR%\""

:: Wait for Auth emulator to become ready (up to 30 seconds)
echo Waiting for emulators to start...
set EMULATOR_READY=0
for /L %%i in (1,1,30) do (
    if !EMULATOR_READY!==0 (
        timeout /t 1 /nobreak >nul
        curl.exe -s -o nul -w "%%{http_code}" http://localhost:9099/ >nul 2>&1
        if not errorlevel 1 set EMULATOR_READY=1
    )
)

if !EMULATOR_READY!==0 (
    echo.
    echo ERROR: Auth emulator failed to start on port 9099.
    pause
    exit /b 1
)

echo.
echo Emulators started. Seeding admin account...
echo.

:: Load .env credentials and auto-seed admin account
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        set "_key=%%A"
        if "!_key:~0,1!" neq "#" (
            set "%%A=%%B"
        )
    )
)

if not defined EMULATOR_ADMIN_EMAIL set "EMULATOR_ADMIN_EMAIL=%ADMIN_EMAIL%"
node scripts\seed-emulator-admin.js
echo.

echo Starting Praat backend (port 8081)...
start "Praat Backend" cmd /c ".venv\Scripts\python.exe backend\local_server\server.py"
echo.

echo Starting HTTPS server...
echo.

:: Start the HTTPS dev server with emulator env vars
set FIRESTORE_EMULATOR_HOST=localhost:8080
set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
set FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
set STORAGE_EMULATOR_HOST=http://localhost:9199
node server.js

echo.
echo Server stopped.
pause
