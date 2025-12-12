@echo off
echo Setting up HTTPS server...
echo.

REM Try to find Python
set PYTHON_CMD=
where python >nul 2>&1 && set PYTHON_CMD=python
if "%PYTHON_CMD%"=="" where py >nul 2>&1 && set PYTHON_CMD=py
if "%PYTHON_CMD%"=="" (
    echo Python not found in PATH.
    echo.
    echo Please do one of the following:
    echo 1. Restart your terminal/IDE to refresh PATH
    echo 2. Or manually add Python to PATH
    echo 3. Or run Python using full path
    echo.
    pause
    exit /b 1
)

echo Found Python: %PYTHON_CMD%
%PYTHON_CMD% --version
echo.

REM Check for certificates
if exist cert.pem if exist key.pem (
    echo Certificates found!
    echo.
    echo Starting HTTPS server...
    echo.
    %PYTHON_CMD% server.py
) else (
    echo SSL certificates not found!
    echo.
    echo Creating certificates using OpenSSL...
    echo.
    
    REM Try to find OpenSSL
    where openssl >nul 2>&1
    if errorlevel 1 (
        echo OpenSSL not found. Please install one of the following:
        echo.
        echo Option 1: Install mkcert (Easiest)
        echo   1. Download from: https://github.com/FiloSottile/mkcert/releases
        echo   2. Run: mkcert -install
        echo   3. Run: mkcert localhost
        echo   4. Rename: localhost.pem to cert.pem
        echo   5. Rename: localhost-key.pem to key.pem
        echo   6. Run this script again
        echo.
        echo Option 2: Install Git for Windows (includes OpenSSL)
        echo   Download from: https://git-scm.com/download/win
        echo   Then run this script again
        echo.
        pause
        exit /b 1
    )
    
    echo Creating self-signed certificate...
    openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
    
    if exist cert.pem if exist key.pem (
        echo.
        echo Certificates created successfully!
        echo.
        echo Starting HTTPS server...
        echo.
        %PYTHON_CMD% server.py
    ) else (
        echo.
        echo Failed to create certificates.
        pause
        exit /b 1
    )
)

