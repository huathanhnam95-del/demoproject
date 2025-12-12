@echo off
echo Setting up HTTPS server for localhost...
echo.

REM Check if certificates exist
if exist cert.pem if exist key.pem (
    echo Certificates found!
    echo.
    echo Starting server...
    echo.
    python server.py
    goto :end
)

echo SSL certificates not found!
echo.
echo You need to create SSL certificates first.
echo.
echo Option 1: Using mkcert (Easiest - Recommended)
echo   1. Download mkcert from: https://github.com/FiloSottile/mkcert/releases
echo   2. Run: mkcert -install
echo   3. Run: mkcert localhost
echo   4. Rename localhost+1.pem to cert.pem
echo   5. Rename localhost+1-key.pem to key.pem
echo.
echo Option 2: Using OpenSSL (if you have Git Bash or WSL)
echo   openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
echo.
echo Option 3: Install Python and use server.py
echo   Or install Node.js and use: npm install && npm start
echo.
pause

:end

