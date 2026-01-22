@echo off
title Pronunciation Analyzer Server (HTTPS)
cd /d "%~dp0"
echo Starting Pronunciation Analyzer Server with HTTPS...
echo.
echo Once started, open: https://localhost:8080
echo.
python server.py
pause
