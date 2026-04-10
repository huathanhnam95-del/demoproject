@echo off
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

:: Start emulators in the background
start "Firebase Emulators" cmd /c "set JAVA_HOME=%JAVA_HOME%&& set PATH=%JAVA_HOME%\bin;%PATH%&& npx firebase emulators:start --only firestore,auth,functions,storage --project listening-tasks-3ae34"

:: Give emulators a moment to boot
timeout /t 5 /nobreak >nul

echo Emulators started. Now starting HTTPS server...
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
