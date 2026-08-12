@echo off
setlocal
cd /d "%~dp0..\.."

:run_worker
echo [%date% %time%] Starting BEL production Essay AI worker...
".venv\Scripts\python.exe" "scripts\essay_local_batch_worker.py" --production
set "WORKER_EXIT_CODE=%ERRORLEVEL%"
echo [%date% %time%] Worker exited with code %WORKER_EXIT_CODE%. Retrying in 60 seconds...
timeout /t 60 /nobreak >nul
goto run_worker
