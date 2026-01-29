@echo off
setlocal
echo ==========================================
echo   SSL Trust Setup for Local Development
echo ==========================================
echo.

:: Check if mkcert exists
if not exist "mkcert.exe" (
    echo [ERROR] mkcert.exe not found in the root directory.
    echo Please make sure mkcert.exe is present.
    pause
    exit /b 1
)

echo [1/3] Cleaning up old, untrusted certificates...
if exist "cert.pem" del "cert.pem"
if exist "key.pem" del "key.pem"
if exist "localhost.pem" del "localhost.pem"
if exist "localhost-key.pem" del "localhost-key.pem"

echo.
echo [2/3] Installing Local Root CA (requires Administrator)...
:: This needs to run once to make the OS trust mkcert's CA
.\mkcert.exe -install

echo.
echo [3/3] Generating NEW trusted certificates for localhost...
:: Create certs for both localhost and 127.0.0.1
.\mkcert.exe -key-file localhost-key.pem -cert-file localhost.pem localhost 127.0.0.1 ::1

echo.
echo [3/3] Verifying certificates...
if exist "localhost.pem" (
    echo [SUCCESS] localhost.pem generated.
    echo [SUCCESS] localhost-key.pem generated.
) else (
    echo [FAILED] Certificate generation failed.
)

echo.
echo ==========================================
echo   SETUP COMPLETE!
echo ==========================================
echo 1. Close ALL Chrome/browser windows.
echo 2. Restart 'node server.js'
echo 3. Refresh https://localhost:8443
echo.
pause
