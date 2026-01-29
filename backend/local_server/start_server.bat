@echo off
title Pronunciation Analyzer API (Flask)
cd /d "%~dp0"

echo.
echo Cleaning up old API processes...
taskkill /F /IM python.exe /FI "WINDOWTITLE eq Flask API 8081" >nul 2>&1

echo Starting Pronunciation Analyzer API on port 8081...
echo.
echo Once started, the API is available at: https://localhost:8081
echo.
python server.py
pause
