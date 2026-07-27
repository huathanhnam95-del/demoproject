@echo off
setlocal
cd /d "%~dp..\.."
python scripts\essay_local_batch_worker.py --production
exit /b %ERRORLEVEL%
